# Flutter Sticker Converter

A minimal Flutter app that:

- Picks multiple images with the system picker
- Resizes each to 512×512 (center-crop)
- Re-encodes to WEBP and reduces quality to fit under 100KB (WhatsApp static sticker limits)
- Saves the output into your app documents folder

## Prerequisites

- Flutter SDK installed (`flutter --version`)
- Android SDK + an emulator or a physical device (`adb devices`)

## Get started

```bash
cd flutter_sticker_converter

# Generate platform folders (android/ios/web) using your current Flutter SDK
flutter create .

# Install Dart dependencies
flutter pub get

# Run on the first available device/emulator
flutter run

# Or specify a device
flutter devices
flutter run -d <device_id>
```

## Notes

- Uses pure-Dart image processing via the `image` package — no native linking.
- Uses `file_picker` to invoke the platform file picker (SAF on Android), so no storage permissions are needed for picking.
- Output files are saved under your app documents directory at a path similar to:
  - Android: `/data/user/0/<package>/app_flutter/StickerConverter/packs/<timestamp>/sticker_*.webp`

## Next steps (optional)

- Zip the output folder to share a pack.
- Add emoji tagging to each sticker.
- Implement direct WhatsApp pack install (requires a custom ContentProvider on Android).

