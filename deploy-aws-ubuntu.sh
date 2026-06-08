#!/usr/bin/env bash
set -Eeuo pipefail

# One-file Ubuntu deployment for Careerwill SSC CGL Tracker.
# Run on a fresh AWS Ubuntu server from this project directory:
#   chmod +x deploy-aws-ubuntu.sh
#   sudo ./deploy-aws-ubuntu.sh
#
# Optional non-interactive example:
#   sudo APP_DOMAIN=yourdomain.com MONGODB_URI='mongodb+srv://...' ADMIN_USERNAME=admin ADMIN_PASSWORD='change-me' ./deploy-aws-ubuntu.sh

APP_NAME="${APP_NAME:-ssc-tracker}"
APP_USER="${APP_USER:-ssc-tracker}"
APP_DIR="${APP_DIR:-/opt/ssc-tracker}"
APP_PORT="${APP_PORT:-3000}"
NODE_MAJOR="${NODE_MAJOR:-20}"
DOMAIN="${APP_DOMAIN:-}"
ENABLE_SSL="${ENABLE_SSL:-auto}"
RUN_SEED_ADMIN="${RUN_SEED_ADMIN:-yes}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() {
  printf '\n[%s] %s\n' "$(date +'%H:%M:%S')" "$*"
}

die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "Run this script with sudo."
  fi
}

prompt_if_empty() {
  local var_name="$1"
  local prompt_text="$2"
  local default_value="${3:-}"
  local current_value="${!var_name:-}"

  if [[ -n "${current_value}" ]]; then
    return 0
  fi

  if [[ -n "${default_value}" ]]; then
    read -r -p "${prompt_text} [${default_value}]: " current_value
    current_value="${current_value:-$default_value}"
  else
    read -r -p "${prompt_text}: " current_value
  fi

  printf -v "${var_name}" '%s' "${current_value}"
}

prompt_secret_if_empty() {
  local var_name="$1"
  local prompt_text="$2"
  local current_value="${!var_name:-}"

  if [[ -n "${current_value}" ]]; then
    return 0
  fi

  read -r -s -p "${prompt_text}: " current_value
  printf '\n'
  printf -v "${var_name}" '%s' "${current_value}"
}

random_hex() {
  openssl rand -hex 48
}

install_system_packages() {
  log "Installing system packages"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    nginx \
    openssl \
    rsync \
    ufw
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    local current_major
    current_major="$(node -p "Number(process.versions.node.split('.')[0])" || echo 0)"
    if [[ "${current_major}" -ge "${NODE_MAJOR}" ]]; then
      log "Node.js $(node -v) already installed"
      return 0
    fi
  fi

  log "Installing Node.js ${NODE_MAJOR}.x"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  node -v
  npm -v
}

create_app_user() {
  if id "${APP_USER}" >/dev/null 2>&1; then
    log "User ${APP_USER} already exists"
  else
    log "Creating system user ${APP_USER}"
    useradd --system --create-home --home-dir "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
  fi
}

copy_project() {
  log "Copying project to ${APP_DIR}"
  mkdir -p "${APP_DIR}"
  rsync -a \
    --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.env' \
    --exclude '.env.*' \
    --exclude '.codex-cdp-profile' \
    --exclude '*.log' \
    "${SOURCE_DIR}/" "${APP_DIR}/"
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
}

collect_env() {
  if [[ -f "${APP_DIR}/.env" ]]; then
    log "Existing ${APP_DIR}/.env found; keeping it"
    return 0
  fi

  log "Creating production .env"
  prompt_if_empty DOMAIN "Domain or public IP for SITE_URL" "${DOMAIN:-$(curl -fsS --max-time 2 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo localhost)}"
  prompt_if_empty MONGODB_URI "MongoDB connection string"
  [[ -n "${MONGODB_URI:-}" ]] || die "MONGODB_URI is required. Use MongoDB Atlas or another MongoDB server."
  prompt_if_empty ADMIN_USERNAME "Initial admin username" "${ADMIN_USERNAME:-admin}"
  prompt_secret_if_empty ADMIN_PASSWORD "Initial admin password"
  [[ -n "${ADMIN_PASSWORD:-}" ]] || die "ADMIN_PASSWORD cannot be empty."

  SESSION_SECRET="${SESSION_SECRET:-$(random_hex)}"
  CSRF_SECRET="${CSRF_SECRET:-$(random_hex)}"

  local site_url
  if [[ "${DOMAIN}" == "localhost" ]]; then
    site_url="http://localhost:${APP_PORT}"
  else
    site_url="http://${DOMAIN}"
  fi

  cat > "${APP_DIR}/.env" <<ENV
NODE_ENV=production
PORT=${APP_PORT}
MONGODB_URI=${MONGODB_URI}
SESSION_SECRET=${SESSION_SECRET}
CSRF_SECRET=${CSRF_SECRET}
SECURE_COOKIES=false
ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
SITE_URL=${site_url}
SMTP_ENABLED=false
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
ENV

  chmod 600 "${APP_DIR}/.env"
  chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
}

install_app_dependencies() {
  log "Installing app dependencies"
  cd "${APP_DIR}"
  if [[ -f package-lock.json ]]; then
    sudo -u "${APP_USER}" npm ci --omit=dev
  else
    sudo -u "${APP_USER}" npm install --omit=dev
  fi

  if [[ -d data/raw ]]; then
    log "Building topics"
    sudo -u "${APP_USER}" node scripts/build-topics.js
  fi
}

seed_admin() {
  if [[ "${RUN_SEED_ADMIN}" != "yes" ]]; then
    log "Skipping admin seed because RUN_SEED_ADMIN=${RUN_SEED_ADMIN}"
    return 0
  fi

  log "Seeding admin account"
  cd "${APP_DIR}"
  set +e
  sudo -u "${APP_USER}" npm run seed-admin
  local status=$?
  set -e
  if [[ "${status}" -ne 0 ]]; then
    log "Admin seed command returned ${status}. Continuing; this usually means the admin already exists or MongoDB rejected the connection."
  fi
}

write_systemd_service() {
  log "Writing systemd service"
  cat > "/etc/systemd/system/${APP_NAME}.service" <<SERVICE
[Unit]
Description=Careerwill SSC CGL Tracker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/node ${APP_DIR}/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${APP_DIR}

[Install]
WantedBy=multi-user.target
SERVICE

  systemctl daemon-reload
  systemctl enable "${APP_NAME}"
  systemctl restart "${APP_NAME}"
}

write_nginx_site() {
  log "Configuring Nginx"
  local server_name="${DOMAIN:-_}"
  [[ "${server_name}" == "localhost" ]] && server_name="_"

  cat > "/etc/nginx/sites-available/${APP_NAME}" <<NGINX
server {
    listen 80;
    server_name ${server_name};

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX

  ln -sfn "/etc/nginx/sites-available/${APP_NAME}" "/etc/nginx/sites-enabled/${APP_NAME}"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
}

configure_firewall() {
  if command -v ufw >/dev/null 2>&1; then
    log "Configuring UFW firewall"
    ufw allow OpenSSH >/dev/null || true
    ufw allow 'Nginx Full' >/dev/null || true
    if ! ufw status | grep -q "Status: active"; then
      yes | ufw enable >/dev/null || true
    fi
  fi
}

maybe_enable_ssl() {
  if [[ -z "${DOMAIN}" || "${DOMAIN}" == "localhost" || "${ENABLE_SSL}" == "no" ]]; then
    return 0
  fi

  if [[ "${ENABLE_SSL}" == "auto" ]]; then
    read -r -p "Install Let's Encrypt HTTPS for ${DOMAIN}? [y/N]: " ssl_answer
    [[ "${ssl_answer,,}" == "y" || "${ssl_answer,,}" == "yes" ]] || return 0
  fi

  log "Installing Certbot and requesting HTTPS certificate"
  DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --redirect --register-unsafely-without-email

  if grep -q '^SITE_URL=http://' "${APP_DIR}/.env"; then
    sed -i "s|^SITE_URL=http://|SITE_URL=https://|" "${APP_DIR}/.env"
  fi
  if grep -q '^SECURE_COOKIES=' "${APP_DIR}/.env"; then
    sed -i "s|^SECURE_COOKIES=.*|SECURE_COOKIES=true|" "${APP_DIR}/.env"
  else
    echo "SECURE_COOKIES=true" >> "${APP_DIR}/.env"
  fi
  systemctl restart "${APP_NAME}"
}

verify_deploy() {
  log "Verifying deployment"
  sleep 3
  systemctl --no-pager --full status "${APP_NAME}" || true

  local health_url="http://127.0.0.1:${APP_PORT}/api/csrf-token"
  if curl -fsS "${health_url}" >/dev/null; then
    log "App health check passed: ${health_url}"
  else
    journalctl -u "${APP_NAME}" --no-pager -n 80 || true
    die "App health check failed."
  fi

  local public_url
  if [[ -n "${DOMAIN}" && "${DOMAIN}" != "localhost" ]]; then
    public_url="http://${DOMAIN}"
  else
    public_url="http://$(curl -fsS --max-time 2 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || hostname -I | awk '{print $1}')"
  fi

  log "Deployment complete"
  printf 'Open: %s\n' "${public_url}"
  printf 'Service: systemctl status %s\n' "${APP_NAME}"
  printf 'Logs: journalctl -u %s -f\n' "${APP_NAME}"
}

main() {
  need_root
  install_system_packages
  install_node
  create_app_user
  copy_project
  collect_env
  install_app_dependencies
  seed_admin
  write_systemd_service
  write_nginx_site
  configure_firewall
  maybe_enable_ssl
  verify_deploy
}

main "$@"
