# 🚀 Деплой RAGE ARENA на сервер

Цель: Сервер `82.146.42.213`, путь `/var/www/rage.xedoc.ru`, домен `rage.xedoc.ru`

## Предварительные требования на сервере (один раз)

Выполни эти команды на сервере (под root или через sudo):

```bash
# 1. Обнови систему
apt update && apt upgrade -y

# 2. Установи Node.js 20+ (через nodesource)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 3. Установи PM2 глобально
npm install -g pm2

# 4. Установи Nginx
apt install -y nginx

# 5. Установи Certbot (для бесплатного SSL)
apt install -y certbot python3-certbot-nginx

# 6. Создай директории
mkdir -p /var/www/rage.xedoc.ru
mkdir -p /var/www/rage.xedoc.ru.git
```

## 1. Настройка Git деплоя (через git push)

На сервере:

```bash
cd /var/www/rage.xedoc.ru.git
 git init --bare

# Скопируй хук деплоя
# (предварительно скачай или создай файл из server-configs/post-receive)
cp /путь/к/локальному/проекту/server-configs/post-receive hooks/post-receive
chmod +x hooks/post-receive
```

На твоей локальной машине (в этом проекте):

```bash
# Добавь remote для деплоя
git remote add production ssh://root@82.146.42.213/var/www/rage.xedoc.ru.git

# Или если пользователь другой:
# git remote add production ssh://youruser@82.146.42.213/var/www/rage.xedoc.ru.git

# Первый деплой (или после изменений)
git push production main
```

После `git push` хук автоматически:
- Сделает checkout кода в `/var/www/rage.xedoc.ru`
- Выполнит `npm ci --production`
- Перезапустит приложение через PM2

## 2. Первый запуск на сервере (если нужно вручную)

```bash
cd /var/www/rage.xedoc.ru

# Установи зависимости
npm ci --production

# Запусти через PM2
pm2 start ecosystem.config.js --env production

# Сохрани, чтобы стартовало после перезагрузки
pm2 save
pm2 startup
```

Проверь статус:
```bash
pm2 status
pm2 logs rage-arena
```

Приложение должно быть доступно на `http://82.146.42.213:3000`

## 3. Настройка Nginx + Домен rage.xedoc.ru

### Шаг 3.1 — Скопируй конфиг Nginx

На сервере:

```bash
# Скопируй конфиг из проекта (после клонирования)
cp /var/www/rage.xedoc.ru/server-configs/nginx-rage.xedoc.ru.conf /etc/nginx/sites-available/rage.xedoc.ru

# Активируй сайт
ln -s /etc/nginx/sites-available/rage.xedoc.ru /etc/nginx/sites-enabled/

# Удали дефолтный если мешает
rm -f /etc/nginx/sites-enabled/default
```

### Шаг 3.2 — Проверь и примени Nginx

```bash
nginx -t
systemctl reload nginx
```

На этом этапе сайт должен открываться по HTTP: `http://rage.xedoc.ru`

### Шаг 3.3 — Настройка SSL (Let's Encrypt) — рекомендуется сразу

```bash
certbot --nginx -d rage.xedoc.ru -d www.rage.xedoc.ru
```

Certbot автоматически:
- Получит сертификат
- Обновит nginx конфиг (раскомментирует HTTPS секцию)
- Добавит автоматическое обновление сертификатов

После этого:
- Перенаправление HTTP → HTTPS будет работать
- Доступ: **https://rage.xedoc.ru**

Проверь:
```bash
certbot certificates
```

## Полезные команды

```bash
# Логи приложения
pm2 logs rage-arena --lines 100

# Перезапуск
pm2 restart rage-arena

# Мониторинг
pm2 monit

# Статус Nginx
systemctl status nginx

# Перезагрузка Nginx
systemctl reload nginx

# Проверка порта
ss -tlnp | grep 3000
```

## Структура после деплоя

```
/var/www/rage.xedoc.ru/          ← рабочая копия кода
├── server.js
├── public/
├── ecosystem.config.js
├── package.json
├── ...

/var/www/rage.xedoc.ru.git/     ← bare репозиторий для git push
```

## Важно: WebSocket / Socket.io

В конфиге Nginx уже включена поддержка WebSocket (`Upgrade` + `Connection: upgrade`).

Если чат не работает — проверь, что `proxy_read_timeout` и `proxy_send_timeout` стоят на 86400.

## Troubleshooting

1. Приложение не стартует:
   ```bash
   pm2 logs rage-arena
   cd /var/www/rage.xedoc.ru && node server.js   # проверить вручную
   ```

2. 502 Bad Gateway:
   - Убедись, что PM2 запущен и слушает 3000
   - `pm2 restart rage-arena`

3. Домен не открывается:
   - Убедись, что DNS A-запись `rage.xedoc.ru` указывает на `82.146.42.213`
   - Проверь `curl -I http://rage.xedoc.ru`

4. После обновления кода ничего не поменялось:
   - `git push production main` ещё раз
   - Или зайди на сервер и выполни `cd /var/www/rage.xedoc.ru && git pull` (если не через хук)

---

Готово! После выполнения всех шагов сайт будет доступен по адресу:
**хтtпs://rage.xedoc.ru** (или http пока без SSL)

Приятной игры в чате! 🔥