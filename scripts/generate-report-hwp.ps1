$ErrorActionPreference = "Stop"

$project = Split-Path -Parent $PSScriptRoot
$reportPath = Join-Path $project "docs\report.md"
$checklistPath = Join-Path $project "docs\checklist.md"
$artifacts = Join-Path $project "docs\artifacts"
$downloads = Join-Path $HOME "Downloads"
$genericTarget = Join-Path $artifacts "tiny-secondhand-platform-report.hwp"
$submissionTarget = Join-Path $artifacts "[WHS][secure-coding][03반]서승린(9585).hwp"
$downloadsTarget = Join-Path $downloads "[WHS][secure-coding][03반]서승린(9585).hwp"

function Convert-MarkdownToPlainText {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Markdown
  )

  $output = New-Object System.Collections.Generic.List[string]
  $inCodeBlock = $false

  foreach ($line in ($Markdown -split "`r?`n")) {
    $trimmed = $line.TrimEnd()

    if ($trimmed -match '^```') {
      $inCodeBlock = -not $inCodeBlock
      continue
    }

    if ($inCodeBlock) {
      $output.Add($trimmed)
      continue
    }

    if ($trimmed -match '^\s*#{1,6}\s*(.+)$') {
      $title = $matches[1].Trim()
      $output.Add($title)
      $output.Add(("=" * [Math]::Min([Math]::Max($title.Length, 8), 40)))
      $output.Add("")
      continue
    }

    if ($trimmed -match '^\s*-\s\[(x| )\]\s*(.+)$') {
      $mark = if ($matches[1] -eq "x") { "[완료]" } else { "[ ]" }
      $output.Add("$mark $($matches[2].Trim())")
      continue
    }

    if ($trimmed -match '^\s*-\s+(.+)$') {
      $output.Add("• $($matches[1].Trim())")
      continue
    }

    if ($trimmed -match '^\s*\|(?:\s*-+\s*\|)+\s*$') {
      continue
    }

    if ($trimmed -match '^\s*\|(.+)\|\s*$') {
      $parts = $trimmed.Trim('|').Split('|') | ForEach-Object { $_.Trim() }
      $parts = $parts | Where-Object { $_ -ne "" }
      if ($parts.Count -gt 0) {
        $output.Add(($parts -join "    |    "))
      }
      continue
    }

    $normalized = $trimmed.Replace("`t", "  ")
    $normalized = $normalized -replace '`', ''
    $output.Add($normalized)
  }

  return ($output -join "`r`n").Trim()
}

$reportMarkdown = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8
$checklistMarkdown = Get-Content -LiteralPath $checklistPath -Raw -Encoding UTF8

$documentText = @"
Tiny Second-hand Shopping Platform 개발 보고서
작성일: 2026-07-24
작성자: 서승린
GitHub: https://github.com/garry15907/TSP-WHS4

[개발 보고서]

$(Convert-MarkdownToPlainText -Markdown $reportMarkdown)


[체크리스트 및 테스트 결과]

$(Convert-MarkdownToPlainText -Markdown $checklistMarkdown)
"@

New-Item -ItemType Directory -Path $artifacts -Force | Out-Null

$hwp = $null
try {
  $hwp = New-Object -ComObject HWPFrame.HwpObject
  try { $hwp.XHwpWindows.Item(0).Visible = $false } catch {}
  $hwp.XHwpDocuments.Add($false) | Out-Null
  $result = $hwp.SetTextFile($documentText, "TEXT", "")
  if ($result -ne 1) {
    throw "HWP text import failed."
  }
  $saved1 = $hwp.SaveAs($genericTarget, "HWP", "")
  if (-not $saved1) {
    throw "Failed to save generic HWP artifact."
  }
} finally {
  if ($hwp) {
    try { $hwp.Clear(1) | Out-Null } catch {}
    try { $hwp.Quit() } catch {}
  }
}

Copy-Item -LiteralPath $genericTarget -Destination $submissionTarget -Force
Copy-Item -LiteralPath $submissionTarget -Destination $downloadsTarget -Force

Get-Item -LiteralPath $genericTarget, $submissionTarget, $downloadsTarget |
  Select-Object FullName, Length, LastWriteTime |
  Format-Table -AutoSize
