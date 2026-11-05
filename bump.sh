#!/bin/sh
# Change le numéro de version partout pour que les téléphones chargent la nouvelle version.
V=$(date -u +%Y%m%d%H%M)
sed -i -E "s/(config|app|assistant)\.js\?v=[0-9A-Z_]+/\1.js?v=$V/g" index.html app.js
sed -i -E "s/school\.js\?v=[0-9A-Z_]+/school.js?v=$V/g; s/^const VERSION = \"[0-9]+\";/const VERSION = \"$V\";/" app.js assistant.js
printf '{"v":"%s"}\n' "$V" > version.json
echo "Version $V"
