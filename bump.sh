#!/bin/sh
# Change le numéro de version partout pour que les téléphones chargent la nouvelle version.
V=$(date -u +%Y%m%d%H%M)
sed -i -E "s/(config|app)\.js\?v=[0-9]+/\1.js?v=$V/g" index.html
sed -i -E "s/school\.js\?v=[0-9A-Z_]+/school.js?v=$V/; s/^const VERSION = \"[0-9]+\";/const VERSION = \"$V\";/" app.js
printf '{"v":"%s"}\n' "$V" > version.json
echo "Version $V"
# Essai B (dossier essai-b) : mêmes numéros de version
if [ -d essai-b ]; then
  sed -i -E "s/(app|assistant)\.js\?v=[0-9A-Z_]+/\1.js?v=$V/g; s/config\.js\?v=[0-9]+/config.js?v=$V/g" essai-b/index.html essai-b/app.js
  sed -i -E "s/school\.js\?v=[0-9A-Z_]+/school.js?v=$V/g; s/^const VERSION = \"[0-9]+\";/const VERSION = \"$V\";/" essai-b/app.js essai-b/assistant.js
  printf '{"v":"%s"}\n' "$V" > essai-b/version.json
fi
