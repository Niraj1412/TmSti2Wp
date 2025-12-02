const fs = require('fs');
const path = require('path');

function log(msg) {
  console.log(`[sync-android-version] ${msg}`);
}

function fail(msg) {
  console.error(`[sync-android-version] ERROR: ${msg}`);
  process.exit(1);
}

try {
  const root = process.cwd();
  const pkgPath = path.join(root, 'package.json');
  const gradlePath = path.join(root, 'android', 'app', 'build.gradle');

  if (!fs.existsSync(pkgPath)) fail('package.json not found');
  if (!fs.existsSync(gradlePath)) fail('android/app/build.gradle not found');

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const newVersion = pkg.version;
  if (!newVersion) fail('package.json missing version');

  let gradle = fs.readFileSync(gradlePath, 'utf8');

  const nameMatch = gradle.match(/versionName\s+"([^"]+)"/);
  const codeMatch = gradle.match(/versionCode\s+(\d+)/);

  if (!nameMatch) fail('Could not find versionName in build.gradle');
  if (!codeMatch) fail('Could not find versionCode in build.gradle');

  const currentName = nameMatch[1];
  const currentCode = parseInt(codeMatch[1], 10);

  let nextCode = currentCode;
  if (currentName !== newVersion) {
    nextCode = currentCode + 1;
  }

  gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${newVersion}"`);
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${nextCode}`);

  fs.writeFileSync(gradlePath, gradle, 'utf8');

  log(`versionName: ${currentName} -> ${newVersion}`);
  if (nextCode !== currentCode) {
    log(`versionCode: ${currentCode} -> ${nextCode}`);
  } else {
    log(`versionCode: unchanged (${currentCode})`);
  }
  log('Updated android/app/build.gradle successfully.');
} catch (err) {
  fail(err && err.message ? err.message : String(err));
}

