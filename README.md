# NFR 26 DAQ Interface

This is the data tool for NFR 26. It records CAN data off the car, stores it, and shows it to you in a dashboard. You can run it live or open old sessions later.

The repo is split into a few folders. Here is what each one does.

## app/

This is the frontend. It is a React app made with Vite. Everything you see in the window (graphs, gauges, settings page, the storage setup screen, the import button, the broadcast toggle) lives here. It does not talk to the car or the database directly. It just makes HTTP and WebSocket calls to the local server.

When you run the desktop app, the frontend gets built into static HTML/CSS/JS files and served by the server inside the Electron window.

## desktop/

This is the Electron shell plus the local server. It is the part that actually runs on your computer and makes everything work together.

Inside it:

- `desktop/main/` is the Node server. It boots an embedded Postgres database, runs migrations, starts the parser, and serves a Fastify API on port 4444. Routes live in `desktop/main/src/server/routes/`.
- `desktop/preload/` is a small bridge that lets the frontend ask Electron for things it cannot do itself, like opening a folder picker.
- `desktop/build/` has the build script and the vendored Postgres 17 binaries that ship inside the app. This means users do not need to install Postgres themselves.

When you build the .dmg, electron-builder packages all of this into one app and copies the frontend, the parser binary, the Postgres binaries, the migrations, and the DBC file into the app bundle.

## parser/

This is the Python program that reads the actual data. It does two main things:

1. Live mode. It opens a serial port, reads CAN frames coming off the car, decodes them using the DBC file, and writes them into Postgres in real time. The frontend gets the same frames over a WebSocket so you see them as they happen.
2. Batch mode. It reads a `.nfr` file (a binary log from the SD card on the car), decodes every frame, and inserts everything into Postgres as one session you can scroll through later.

The parser gets shipped as a single binary made with PyInstaller. The desktop app spawns it as a subprocess and tells it which mode to run in.

## docs/

Notes, design files, and references for the project. Nothing here runs.

## NFR26DBC.csv

The DBC file. It is the lookup table that tells the parser how to turn raw CAN bytes into named signals like `BMS_SOC` or `Battery_Voltage`. If the firmware on the car changes its message layout, this file has to change too.

## How it all fits together

You open the app. Electron starts the local server. The server boots embedded Postgres and runs migrations. The server spawns the parser, which connects to the car (or replays a file). The frontend opens in the Electron window and pulls live frames over a WebSocket and historical sessions over the HTTP API. You can also turn on broadcast mode in settings, which makes the dashboard reachable from any browser on the same WiFi.

## Running it for development

```
cd app && npm install && npm run dev      # frontend dev server on :5173
cd desktop && npm install                 # install electron deps
cd parser && python -m venv .venv && source .venv/bin/activate && pip install -e .
```

Then in the desktop folder run the orchestrator pointed at a Postgres you already have, or build the dmg with `npm run package` to get the standalone app.

## Building the .dmg

```
cd app && npm run build
cd parser && ./build.sh
cd desktop && npm run package
```

The output ends up in `desktop/release/`.
