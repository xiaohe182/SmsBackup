param(
    [Parameter(Mandatory = $false)]
    [string]$ApkPath
)

$ErrorActionPreference = 'Stop'

# Verify the latest release APK by default so the command can be reused after every cloud build.
$projectRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ApkPath)) {
    $latestApk = Get-ChildItem (Join-Path $projectRoot 'dist\release\apk') -Filter '*.apk' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($null -eq $latestApk) {
        throw 'No APK was found. Build the Android package first.'
    }

    $ApkPath = $latestApk.FullName
}

$resolvedApk = (Resolve-Path -LiteralPath $ApkPath).Path
Add-Type -AssemblyName System.IO.Compression

# An APK is a ZIP archive. Read every classes*.dex entry and inspect stable native markers.
$fileStream = [System.IO.File]::OpenRead($resolvedApk)
try {
    $archive = [System.IO.Compression.ZipArchive]::new(
        $fileStream,
        [System.IO.Compression.ZipArchiveMode]::Read,
        $false
    )

    try {
        $dexEntries = @($archive.Entries | Where-Object { $_.FullName -match '^classes\d*\.dex$' })
        if ($dexEntries.Count -eq 0) {
            throw "No DEX entry was found in APK: $resolvedApk"
        }

        $dexTextBuilder = [System.Text.StringBuilder]::new()
        foreach ($entry in $dexEntries) {
            $entryStream = $entry.Open()
            $memoryStream = [System.IO.MemoryStream]::new()
            try {
                $entryStream.CopyTo($memoryStream)
                [void]$dexTextBuilder.Append(
                    [System.Text.Encoding]::ASCII.GetString($memoryStream.ToArray())
                )
            }
            finally {
                $memoryStream.Dispose()
                $entryStream.Dispose()
            }
        }

        $dexText = $dexTextBuilder.ToString()

        # Cover media sync, server command polling, media manifest, and the new SMS viewer bridge.
        $requiredMarkers = @(
            'MediaSyncWorker',
            'MediaSyncRepository',
            'smsBackupNativeV2',
            '/api/device',
            '/api/media/manifest',
            'requestMediaPermissions',
            'getConversationSummaries'
        )

        # All SMS messages must be collected, so the old blacklist implementation must be absent.
        $forbiddenMarkers = @(
            'SmsFilter',
            'BlacklistRule'
        )

        $missingMarkers = @($requiredMarkers | Where-Object { -not $dexText.Contains($_) })
        $staleMarkers = @($forbiddenMarkers | Where-Object { $dexText.Contains($_) })

        if ($missingMarkers.Count -gt 0 -or $staleMarkers.Count -gt 0) {
            Write-Error (
                "APK native verification failed. Missing current markers: [{0}]; stale markers: [{1}]; APK: {2}" -f
                ($missingMarkers -join ', '),
                ($staleMarkers -join ', '),
                $resolvedApk
            )
        }

        Write-Output "APK native verification passed: $resolvedApk"
    }
    finally {
        $archive.Dispose()
    }
}
finally {
    $fileStream.Dispose()
}
