# TBCC Utility

Private distribution tree for the bare-metal Chrome/Edge extension (v1.41.0).

## Sideload

1. Download the release zip **or** clone this repo
2. `chrome://extensions` → Developer mode → Load unpacked → `tbcc-utility/`
3. Options → Upload userscripts for page scripts (slot starts empty)

## Pack from monorepo

```powershell
cd tbcc\extension
.\scripts\pack-utility.ps1
```

Output: `tbcc/dist/tbcc-utility-<version>.zip`
