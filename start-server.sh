#!/bin/bash
cd "$(dirname "$0")"
echo "🚀 Iniciando servidor desde: $(pwd)"
echo "🔍 Archivos disponibles:"
ls -la *.js *.json
echo "🚀 Ejecutando servidor..."
node server.js