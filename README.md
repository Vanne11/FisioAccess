# 🏥 FisioAccess

**Plataforma Unificada para el Monitoreo y Procesamiento de Señales Médicas**

FisioAccess es una solución de escritorio de alto rendimiento diseñada para la adquisición, visualización y análisis en tiempo real de señales biomédicas (ECG, EMG, Espirometría, entre otros). Utiliza **Rust** para un procesamiento de señales seguro y ultra-rápido, y **React 19** para una interfaz de usuario fluida y moderna.

---

## 🚀 Tecnologías Core

* **Core & Runtime:** [Tauri v2](https://v2.tauri.app/) (Rust).
* **Frontend:** React 19, TypeScript, Vite.
* **Estilos & UI:** Tailwind CSS, Shadcn UI, Radix UI.
* **Procesamiento de Señales:** Rust (Filtros digitales Butterworth y Notch).
* **Comunicación:** Serial (tokio-serial) y WebSockets.

---

## 📂 Estructura del Workspace

El proyecto está organizado como un monorepo para maximizar la modularidad y el testing aislado:

```text
fisioacces-integrado/
├── crates/              # Backend Modular (Rust)
│   ├── fisio-core/      # Tipos, traits y modelos de datos compartidos
│   ├── fisio-serial/    # Drivers de comunicación serie
│   ├── fisio-filters/   # Algoritmos de filtrado digital
│   ├── fisio-ecg/       # Análisis de frecuencia cardíaca y complejos QRS
│   ├── fisio-emg/       # Procesamiento de actividad muscular y calibración
│   ├── fisio-spiro/     # Cálculo de volúmenes y flujos respiratorios
│   ├── fisio-data/      # Sistema de persistencia (CSV/JSON)
│   └── fisio-http/      # Servidor para streaming de datos remoto
├── packages/            # Frontend Modular (React)
│   ├── ui-core/         # Design System y hooks globales
│   ├── ecg-module/      # Dashboard especializado en ECG
│   ├── emg-module/      # Dashboard especializado en EMG
│   └── spiro-module/    # Dashboard especializado en Espirometría
├── src-tauri/           # Orquestador del sistema (Bridge Rust-JS)
└── docs/                # Documentación técnica detallada

```

---

## 🛠️ Configuración del Entorno

### 1. Requisitos del Sistema

* **Rust:** v1.75+ (Instalar vía `rustup`).
* **Node.js:** v20+ (LTS).
* **C++ Build Tools:** Necesario para compilar dependencias nativas de Rust en Windows.
* **Dependencias de Linux:**
```bash
sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

```



### 2. Instalación

```bash
# Clonar y entrar al proyecto
git clone https://github.com/tu-usuario/fisioacces-integrado.git
cd fisioacces-integrado

# Instalar dependencias de todos los paquetes (Frontend)
npm install

```

---

## 💻 Flujo de Trabajo (Comandos)

### Desarrollo Desktop

```bash
# Iniciar la aplicación completa con recarga en caliente
npm run tauri dev

```

### Gestión del Backend (Rust)

```bash
# Compilar todo el ecosistema de crates
cargo build --workspace

# Ejecutar tests unitarios de procesamiento de señales
cargo test --workspace

# Generar documentación técnica de la API de Rust
cargo doc --workspace --open

```

### Gestión del Frontend (React)

```bash
# Iniciar un módulo específico (ej: ECG)
npm run dev -w ecg-module

# Ejecutar tests de interfaz
npm test --workspaces

```

---

## 📈 Capacidades de los Módulos

| Módulo | Funcionalidad Principal | Crate Backend Relacionado |
| --- | --- | --- |
| **ECG** | Visualización rítmica, detección de pulso. | `fisio-ecg` |
| **EMG** | Análisis de fatiga muscular, calibración de fuerza. | `fisio-emg` |
| **Espirómetro** | Curvas de flujo-volumen, capacidad vital. | `fisio-spiro` |
| **Data Manager** | Exportación a CSV para análisis en MATLAB/Python. | `fisio-data` |

---

## 🔒 Licencia y Seguridad

Este software está diseñado exclusivamente para fines de monitoreo. **No debe utilizarse para diagnóstico médico crítico sin la validación de hardware certificado.**

* **Licencia:** Todos los derechos reservados - FISIOACCES.
