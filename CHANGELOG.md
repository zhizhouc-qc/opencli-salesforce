# Changelog

All notable changes to this Salesforce OpenCLI adapter collection will be documented here.

## 2026-05-19

### Fixed
- `case-reply --prefix`: improved Case Update modal handling when EasyWork shows the "Timeout to get case information" dialog before the Case Update UI appears.
- `case-reply --prefix`: broadened modal detection to recognize Case Update dialogs rendered through Salesforce modal containers or shadow DOM.
- `case-reply --prefix`: avoided false "opened wrong case" failures caused by unrelated case numbers visible elsewhere on the Salesforce page.

