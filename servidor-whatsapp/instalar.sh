#!/usr/bin/env bash
# BoraLanchar! — servidor do robô do WhatsApp (conexão por código)
# Rode numa VPS Ubuntu 22.04/24.04 nova, como root:
#   curl -fsSL https://raw.githubusercontent.com/matheusvix/site-de-pedidos-de-lanche-Rubra/main/servidor-whatsapp/instalar.sh | bash
# Instala Docker, Evolution API 2.3.7 + Postgres + Redis e HTTPS automático (Caddy).
# No fim mostra o ENDEREÇO e a CHAVE que vão no BoraLanchar.
set -euo pipefail

DIR=/opt/boralanchar-whatsapp
mkdir -p "$DIR" && cd "$DIR"

echo "==> Instalando Docker (se precisar)…"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
DOMINIO="${DOMINIO:-$(echo "$IP" | tr '.' '-').sslip.io}"   # HTTPS sem precisar comprar domínio

if [ ! -f .env ]; then
  KEY=$(openssl rand -hex 24)
  PGPASS=$(openssl rand -hex 16)
  cat > .env <<ENV
SERVER_TYPE=http
SERVER_PORT=8080
SERVER_URL=https://$DOMINIO
LANGUAGE=pt-BR
LOG_LEVEL=ERROR,WARN
DEL_INSTANCE=false
CORS_ORIGIN=*
AUTHENTICATION_API_KEY=$KEY
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
CONFIG_SESSION_PHONE_CLIENT=BoraLanchar
CONFIG_SESSION_PHONE_NAME=Chrome
QRCODE_LIMIT=30
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://evolution:$PGPASS@postgres:5432/evolution?schema=evolution_api
DATABASE_CONNECTION_CLIENT_NAME=boralanchar
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=false
DATABASE_SAVE_MESSAGE_UPDATE=false
DATABASE_SAVE_DATA_CONTACTS=false
DATABASE_SAVE_DATA_CHATS=false
DATABASE_SAVE_DATA_LABELS=false
DATABASE_SAVE_DATA_HISTORIC=false
CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://redis:6379/6
CACHE_REDIS_PREFIX_KEY=boralanchar
CACHE_REDIS_SAVE_INSTANCES=false
CACHE_LOCAL_ENABLED=false
POSTGRES_PASSWORD=$PGPASS
ENV
  chmod 600 .env
fi
set -a; . ./.env; set +a

cat > docker-compose.yml <<'YML'
services:
  evolution:
    image: evoapicloud/evolution-api:v2.3.7
    restart: always
    env_file: .env
    depends_on: [postgres, redis]
    volumes: [instances:/evolution/instances]
  postgres:
    image: postgres:15
    restart: always
    environment:
      POSTGRES_DB: evolution
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes: [pgdata:/var/lib/postgresql/data]
  redis:
    image: redis:7
    restart: always
    command: redis-server --appendonly yes
    volumes: [redisdata:/data]
  caddy:
    image: caddy:2
    restart: always
    ports: ["80:80", "443:443"]
    command: caddy reverse-proxy --from ${CADDY_HOST} --to evolution:8080
    volumes: [caddydata:/data]
volumes: { instances: {}, pgdata: {}, redisdata: {}, caddydata: {} }
YML

grep -q '^CADDY_HOST=' .env || echo "CADDY_HOST=$DOMINIO" >> .env

echo "==> Liberando portas 80 e 443 no firewall (se houver)…"
if command -v ufw >/dev/null 2>&1; then ufw allow 22/tcp >/dev/null || true; ufw allow 80/tcp >/dev/null || true; ufw allow 443/tcp >/dev/null || true; fi

echo "==> Subindo o servidor…"
docker compose --env-file .env up -d

echo "==> Esperando o HTTPS ficar pronto…"
for i in $(seq 1 40); do
  if curl -fsS "https://$DOMINIO/" >/dev/null 2>&1; then break; fi
  sleep 5
done

echo
echo "================ PRONTO ================"
echo " ENDEREÇO: https://$DOMINIO"
echo " CHAVE:    $AUTHENTICATION_API_KEY"
echo "========================================"
echo "Copie esses dois dados e mande para o Claude configurar no BoraLanchar."
echo "(Para ver de novo depois: cat $DIR/.env | grep -E 'SERVER_URL|AUTHENTICATION_API_KEY')"
