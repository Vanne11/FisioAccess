#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()  { echo -e "${BLUE}[info]${NC} $*"; }
ok()    { echo -e "${GREEN}[ok]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }
err()   { echo -e "${RED}[error]${NC} $*" >&2; }

show_banner() {
  echo -e ""
  echo -e "  ${BLUE}${BOLD}FisioAccess${NC} ${DIM}v0.1.0${NC}"
  echo -e "  ${DIM}Plataforma de monitoreo biomedico${NC}"
  echo -e ""
}

show_menu() {
  show_banner
  echo -e "  ${BOLD}DESARROLLO${NC}"
  echo -e "  ${CYAN}1)${NC} dev              ${DIM}- App completa Tauri (frontend + backend)${NC}"
  echo -e "  ${CYAN}2)${NC} dev:frontend     ${DIM}- Solo servidor Vite en :1420${NC}"
  echo -e ""
  echo -e "  ${BOLD}COMPILACION${NC}"
  echo -e "  ${CYAN}3)${NC} build            ${DIM}- Compila la app para produccion${NC}"
  echo -e "  ${CYAN}4)${NC} clean            ${DIM}- Elimina dist/, target/ y node_modules/.cache${NC}"
  echo -e "  ${CYAN}5)${NC} install          ${DIM}- Instala dependencias (npm install + cargo fetch)${NC}"
  echo -e ""
  echo -e "  ${BOLD}VERIFICACION${NC}"
  echo -e "  ${CYAN}6)${NC} check            ${DIM}- Verifica TypeScript y Rust sin compilar${NC}"
  echo -e "  ${CYAN}7)${NC} lint             ${DIM}- Clippy (Rust) + ESLint (TS) si disponible${NC}"
  echo -e "  ${CYAN}8)${NC} test             ${DIM}- Ejecuta tests unitarios de Rust${NC}"
  echo -e ""
  echo -e "  ${BOLD}INFORMACION${NC}"
  echo -e "  ${CYAN}9)${NC} status           ${DIM}- Versiones, dependencias y puertos serial${NC}"
  echo -e ""
  echo -e "  ${CYAN}0)${NC} Salir"
  echo -e ""
}

cmd_dev() {
  info "Iniciando Tauri dev (app completa)..."
  npm run tauri:dev
}

cmd_dev_frontend() {
  info "Iniciando servidor Vite en :1420..."
  npm run dev -- --port 1420
}

cmd_build() {
  info "Compilando frontend..."
  npm run build
  info "Compilando app Tauri..."
  npm run tauri:build
  ok "Build completo"
}

cmd_check() {
  info "Verificando TypeScript..."
  npx tsc --noEmit
  ok "TypeScript OK"

  info "Verificando Rust..."
  (cd src-tauri && cargo check)
  ok "Rust OK"
}

cmd_test() {
  info "Ejecutando tests de Rust..."
  (cd src-tauri && cargo test)
  ok "Tests completos"
}

cmd_clean() {
  info "Eliminando archivos de compilacion..."
  rm -rf dist/
  rm -rf src-tauri/target/
  rm -rf node_modules/.cache
  ok "Limpieza completa"
}

cmd_install() {
  info "Instalando dependencias npm..."
  npm install
  ok "npm OK"

  info "Descargando crates de Rust..."
  (cd src-tauri && cargo fetch)
  ok "cargo OK"
}

cmd_status() {
  echo ""
  echo -e "  ${BLUE}${BOLD}Estado del proyecto${NC}"
  echo ""

  if command -v node &>/dev/null; then
    ok "Node $(node -v)"
  else
    err "Node no encontrado"
  fi

  if command -v npm &>/dev/null; then
    ok "npm $(npm -v)"
  else
    err "npm no encontrado"
  fi

  if command -v rustc &>/dev/null; then
    ok "Rust $(rustc --version | awk '{print $2}')"
  else
    err "Rust no encontrado"
  fi

  if command -v cargo &>/dev/null; then
    ok "Cargo $(cargo --version | awk '{print $2}')"
  else
    err "Cargo no encontrado"
  fi

  echo ""

  if [ -d node_modules ]; then
    ok "node_modules instalados"
  else
    warn "Falta ejecutar: ./fisioaccess.sh install"
  fi

  if [ -d src-tauri/target ]; then
    ok "target/ existe (Rust compilado)"
  else
    info "target/ no existe (primer build pendiente)"
  fi

  echo ""

  if [ -d /dev/serial/by-id/ ] && [ "$(ls -A /dev/serial/by-id/ 2>/dev/null)" ]; then
    info "Puertos serial detectados:"
    ls /dev/serial/by-id/ 2>/dev/null | sed 's/^/    /'
  else
    info "No se detectaron puertos serial"
  fi

  echo ""
}

cmd_lint() {
  info "Ejecutando Clippy (Rust)..."
  (cd src-tauri && cargo clippy -- -D warnings)
  ok "Clippy OK"

  if [ -f node_modules/.bin/eslint ]; then
    info "Ejecutando ESLint (TypeScript)..."
    npx eslint src/ --ext .ts,.tsx
    ok "ESLint OK"
  else
    warn "ESLint no instalado, saltando"
  fi
}

run_option() {
  case "$1" in
    1) cmd_dev ;;
    2) cmd_dev_frontend ;;
    3) cmd_build ;;
    4) cmd_clean ;;
    5) cmd_install ;;
    6) cmd_check ;;
    7) cmd_lint ;;
    8) cmd_test ;;
    9) cmd_status ;;
    0) echo -e "\n  ${GREEN}Hasta luego${NC}\n"; exit 0 ;;
    *) err "Opcion no valida: $1" ;;
  esac
}

# Uso directo con argumentos: ./fisioaccess.sh dev
if [ $# -gt 0 ]; then
  case "$1" in
    dev)          cmd_dev ;;
    dev:frontend) cmd_dev_frontend ;;
    build)        cmd_build ;;
    check)        cmd_check ;;
    test)         cmd_test ;;
    clean)        cmd_clean ;;
    install)      cmd_install ;;
    status)       cmd_status ;;
    lint)         cmd_lint ;;
    help)         show_menu ;;
    [0-9])        run_option "$1" ;;
    *)            err "Comando desconocido: $1"; echo ""; echo "  Uso: ./fisioaccess.sh [dev|dev:frontend|build|check|test|clean|install|status|lint|help]"; exit 1 ;;
  esac
  exit 0
fi

# Menu interactivo
while true; do
  show_menu
  echo -ne "  ${BOLD}Selecciona [0-9]:${NC} "
  read -r option
  echo ""
  run_option "$option"
  echo ""
  echo -ne "  ${DIM}Enter para volver al menu...${NC}"
  read -r
done
