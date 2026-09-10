param([string]$Base, [string]$Head, [string]$Out)
Set-Location 'E:\js_projects\my_deepseek_harness\deepseek_plugins'
$log = (git log --oneline ($Base + '..' + $Head) | Out-String)
$stat = (git diff --stat ($Base + '..' + $Head) | Out-String)
$diff = (git diff -U10 ($Base + '..' + $Head) | Out-String)
$pkg = '# Review package ' + $Base + '..' + $Head + "`n`n" + '## Commits' + "`n`n" + '```' + "`n" + $log + '```' + "`n`n" + '## Stat' + "`n`n" + '```' + "`n" + $stat + '```' + "`n`n" + '## Diff (-U10)' + "`n`n" + '```diff' + "`n" + $diff + '```' + "`n"
Set-Content -LiteralPath $Out -Value $pkg -Encoding UTF8
Write-Output $Out
Write-Output ('pkg_chars=' + $pkg.Length)