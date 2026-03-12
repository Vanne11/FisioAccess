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
  echo -e "  ${BLUE}${BOLD}FisioAccess${NC}"
  echo -e "  ${DIM}Plataforma de monitoreo biomedico${NC}"
  echo -e ""
}

show_menu() {
  show_banner
  echo -e "  ${BOLD}DESARROLLO${NC}"
  echo -e "  ${CYAN}1)${NC} Dev Frontend    ${DIM}- Inicia servidor Vite (solo interfaz web en :1420)${NC}"
  echo -e "  ${CYAN}2)${NC} Dev Tauri        ${DIM}- Inicia la app completa (frontend + backend Rust)${NC}"
  echo -e ""
  echo -e "  ${BOLD}COMPILACION${NC}"
  echo -e "  ${CYAN}3)${NC} Build            ${DIM}- Compila la app para produccion (instalador final)${NC}"
  echo -e "  ${CYAN}4)${NC} Clean            ${DIM}- Elimina archivos de compilacion (dist/ y target/)${NC}"
  echo -e ""
  echo -e "  ${BOLD}VERIFICACION${NC}"
  echo -e "  ${CYAN}5)${NC} Check            ${DIM}- Verifica errores en TypeScript y Rust sin compilar${NC}"
  echo -e "  ${CYAN}6)${NC} Lint             ${DIM}- Analiza calidad del codigo (Clippy + ESLint)${NC}"
  echo -e "  ${CYAN}7)${NC} Test             ${DIM}- Ejecuta las pruebas unitarias de Rust${NC}"
  echo -e ""
  echo -e "  ${BOLD}INFORMACION${NC}"
  echo -e "  ${CYAN}8)${NC} Status           ${DIM}- Muestra versiones, dependencias y puertos serial${NC}"
  echo -e "  ${CYAN}9)${NC} Logs             ${DIM}- Muestra los logs de Tauri en tiempo real${NC}"
  echo -e ""
  echo -e "  ${CYAN}0)${NC} Salir"
  echo -e ""
}

cmd_dev() {
  info "Iniciando servidor Vite en :1420..."
  npx vite --port 1420
}

cmd_tauri() {
  info "Iniciando Tauri dev (app completa)..."
  cd src-tauri && cargo tauri dev
}

cmd_build() {
  info "Compilando frontend..."
  npx vite build
  info "Compilando app Tauri..."
  cd src-tauri && cargo tauri build
  ok "Build completo"
}

cmd_check() {
  info "Verificando TypeScript..."
  npx tsc --noEmit
  ok "TypeScript OK"

  info "Verificando Rust..."
  cd src-tauri && cargo check
  ok "Rust OK"
}

cmd_test() {
  info "Ejecutando tests de Rust..."
  cd src-tauri && cargo test
  ok "Tests completos"
}

cmd_clean() {
  info "Eliminando archivos de compilacion..."
  rm -rf dist/ target/
  ok "Limpieza completa"
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

  if command -v rustc &>/dev/null; then
    ok "Rust $(rustc --version | awk '{print $2}')"
  else
    err "Rust no encontrado"
  fi

  if [ -d node_modules ]; then
    ok "node_modules instalados"
  else
    warn "Falta ejecutar: npm install"
  fi

  if [ -d /dev/serial/by-id/ ]; then
    info "Puertos serial detectados:"
    ls /dev/serial/by-id/ 2>/dev/null | sed 's/^/    /'
  else
    info "No se detectaron puertos serial"
  fi

  echo ""
}

cmd_lint() {
  info "Ejecutando Clippy (Rust)..."
  cd src-tauri && cargo clippy -- -D warnings
  ok "Clippy OK"

  cd "$ROOT"
  if [ -f node_modules/.bin/eslint ]; then
    info "Ejecutando ESLint (TypeScript)..."
    npx eslint src/ --ext .ts,.tsx
    ok "ESLint OK"
  else
    warn "ESLint no instalado"
  fi
}

cmd_logs() {
  local log="src-tauri/tauri.log"
  if [ -f "$log" ]; then
    tail -f "$log"
  else
    warn "No se encontro archivo de log en $log"
    info "Los logs de Tauri aparecen en terminal al usar la opcion 2 (Dev Tauri)"
  fi
}

run_option() {
  case "$1" in
    1) cmd_dev ;;
    2) cmd_tauri ;;
    3) cmd_build ;;
    4) cmd_clean ;;
    5) cmd_check ;;
    6) cmd_lint ;;
    7) cmd_test ;;
    8) cmd_status ;;
    9) cmd_logs ;;
    0) echo -e "\n  ${GREEN}Hasta luego${NC}\n"; exit 0 ;;
    *) err "Opcion no valida: $1" ;;
  esac
}

# Si se pasa un argumento, ejecutar directamente (compatibilidad con uso anterior)
if [ $# -gt 0 ]; then
  case "$1" in
    dev)    cmd_dev ;;
    tauri)  cmd_tauri ;;
    build)  cmd_build ;;
    check)  cmd_check ;;
    test)   cmd_test ;;
    clean)  cmd_clean ;;
    status) cmd_status ;;
    lint)   cmd_lint ;;
    logs)   cmd_logs ;;
    [0-9])  run_option "$1" ;;
    *)      err "Comando desconocido: $1"; show_menu; exit 1 ;;
  esac
  exit 0
fi

# Menu interactivo
while true; do
  show_menu
  echo -ne "  ${BOLD}Selecciona una opcion [0-9]:${NC} "
  read -r option
  echo ""
  run_option "$option"
  echo ""
  echo -ne "  ${DIM}Presiona Enter para volver al menu...${NC}"
  read -r
done
