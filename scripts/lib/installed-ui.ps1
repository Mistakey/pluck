# Only the application's own window on an expendable GitHub-hosted VM.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'This probe requires an expendable hosted Windows VM'
}
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$appProcess = Get-Process -Id ([int]$env:PLUCK_UIA_PID)
if ($appProcess.Path -ne $env:PLUCK_UIA_EXE) { throw 'Unexpected application process' }
$condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $appProcess.Id
)
$window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
    [System.Windows.Automation.TreeScope]::Children, $condition
)
if ($null -eq $window) { throw 'Application window not available yet' }
$elements = $window.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
)
if ($env:PLUCK_UIA_ACTION -eq 'click') {
    $button = $null
    foreach ($element in $elements) {
        if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
            $element.Current.Name -match $env:PLUCK_UIA_NAME) {
            if ($null -ne $button) { throw 'More than one matching application button' }
            $button = $element
        }
    }
    if ($null -eq $button) { throw 'Application button not found' }
    if (-not $button.Current.IsEnabled) { throw 'Application button is disabled' }
    $pattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke()
    '{"clicked":true}'
    exit 0
}
$result = @()
foreach ($element in $elements) {
    $current = $element.Current
    if ($current.Name) {
        $result += [PSCustomObject]@{
            name = $current.Name
            type = $current.ControlType.ProgrammaticName
            enabled = $current.IsEnabled
        }
    }
}
ConvertTo-Json -Depth 4 -Compress -InputObject $result
