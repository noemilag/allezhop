#!/bin/sh
# Copie les fichiers de l'app web dans www/, le dossier que Capacitor met dans les apps iPhone et Android.
set -e
cd "$(dirname "$0")/.."
rm -rf www && mkdir -p www
cp ./*.html ./*.js ./*.webmanifest version.json www/
cp -R icons www/
echo "Fichiers web copiés dans www/"
