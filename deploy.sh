#!/bin/bash
# deploy.sh — автоматический деплой на Orange Pi

set -e  # Остановка при ошибке

echo "🚀 Деплой торрент-NAS на Orange Pi PC"
echo "=============================================="

# Путь к проекту
cd "$(dirname "$0")"

echo "📥 Обновление кода..."
git fetch origin main
git reset --hard origin/main

echo "🧹 Очистка старых контейнеров..."
docker-compose --env-file .env.prod down --remove-orphans
docker system prune -f

echo "📁 Создание/проверка папок..."
mkdir -p storage/downloads qb-config vpn vpn-user-config dl-proxy

echo "🔄 Запуск с ARM эмуляцией (PLATFORM=linux/amd64)..."
docker-compose --env-file .env.prod up -d --build

echo "⏳ Ожидание запуска VPN (20 сек)..."
sleep 20

echo "✅ Проверка статусов:"
docker ps

echo "🌡️ Температура CPU:"
cat /sys/class/thermal/thermal_zone0/temp | awk '{print $1/1000 "°C"}'

echo ""
echo "🌐 Доступ:"
echo "  WebUI:     http://$(hostname -I | awk '{print $1}'):8089"
echo "  qBittorrent: http://$(hostname -I | awk '{print $1}'):8081"
echo "📁 Пути:"
echo "  Downloads:  $(grep DOWNLOADS_PATH .env.prod | cut -d= -f2)"
echo ""
echo "🎉 Деплой завершён! Система готова."
