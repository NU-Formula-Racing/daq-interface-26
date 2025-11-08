"""
Python translation of the Electron + React GUI to a single-file Qt app.

Features:
- Open a CSV file (car data) and display it in a table.
- Dashboard view with simple gauges (progress bars) for common car signals.
- Sidebar navigation (Dashboard / Table).
- Open the CSV table in a separate window (like Electron's second window).
- NEW: Dedicated "Load CSV" button in sidebar.
- NEW: Drag & drop a .csv file anywhere onto the window to load it.

Requirements (install on Windows terminal/PowerShell):
    pip install PySide6
    
New in this Python GUI:
- Load CSV button in the sidebar
- Drag & drop CSV anywhere onto the window
- Time slider to scrub through rows by a time-like column (e.g., time, timestamp, lap)
"""

import csv
import sys
import os
from typing import List, Tuple, Optional, Any, Dict

# ...existing code...
from PySide6.QtCore import Qt, QAbstractTableModel, QModelIndex, QItemSelectionModel
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QFileDialog, QTableView,
    QVBoxLayout, QHBoxLayout, QPushButton, QLabel, QProgressBar, QFrame,
    QStackedLayout, QMessageBox, QSlider
)
from PySide6.QtGui import QAction
# ...existing code...


# ----------------------------
# CSV utilities (translation of csvParser/csvTools.js responsibilities)
# ----------------------------

def _sniff_delimiter(sample: str, fallback: str = ',') -> str:
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=[',', ';', '\t', '|'])
        return dialect.delimiter
    except Exception:
        return fallback


def load_csv(filepath: str) -> Tuple[List[str], List[List[str]]]:
    """
    Load a CSV file, detect delimiter, return (headers, rows).
    Keeps all values as strings; numeric conversion can be done by consumers.
    """
    if not os.path.exists(filepath):
        raise FileNotFoundError(filepath)

    # Read a small sample to sniff delimiter
    with open(filepath, 'r', encoding='utf-8-sig', newline='') as f:
        sample = f.read(4096)
        f.seek(0)
        delimiter = _sniff_delimiter(sample)
        reader = csv.reader(f, delimiter=delimiter)
        rows = list(reader)

    if not rows:
        return [], []

    headers = rows[0]
    data = rows[1:] if len(rows) > 1 else []

    # Normalize headers (strip BOMs/whitespace)
    headers = [h.strip() for h in headers]

    return headers, data


# ----------------------------
# Table Model (translation of Table.jsx responsibilities)
# ----------------------------

class CsvTableModel(QAbstractTableModel):
    def __init__(self, headers: List[str], rows: List[List[str]], parent=None):
        super().__init__(parent)
        self._headers = headers
        self._rows = rows

    def rowCount(self, parent=QModelIndex()) -> int:
        return len(self._rows)

    def columnCount(self, parent=QModelIndex()) -> int:
        return len(self._headers)

    def data(self, index: QModelIndex, role: int = Qt.DisplayRole) -> Any:
        if not index.isValid():
            return None
        if role == Qt.DisplayRole:
            r, c = index.row(), index.column()
            try:
                return self._rows[r][c]
            except Exception:
                return ""
        return None

    def headerData(self, section: int, orientation: Qt.Orientation, role: int = Qt.DisplayRole) -> Any:
        if role != Qt.DisplayRole:
            return None
        if orientation == Qt.Horizontal:
            try:
                return self._headers[section]
            except Exception:
                return f"Col {section}"
        return str(section + 1)

    def set_data(self, headers: List[str], rows: List[List[str]]):
        self.beginResetModel()
        self._headers = headers
        self._rows = rows
        self.endResetModel()


# ----------------------------
# Dashboard (translation of Dashboard.jsx, Display.jsx, AngularGauge.jsx idea)
# ----------------------------

def try_float(value: str) -> Optional[float]:
    try:
        return float(value.replace(',', ''))
    except Exception:
        return None


class DashboardWidget(QWidget):
    """
    Shows simple "gauges" for common car signals based on CSV columns.
    We try to map by common column names (case-insensitive, forgiving).
    """
    COMMON_SIGNALS: Dict[str, Dict[str, Any]] = {
        # key: display label, candidate names, max range for progress bar
        "speed":   {"label": "Speed (km/h)", "candidates": ["speed", "vehicle_speed", "veh_speed", "vss"], "max": 300},
        "rpm":     {"label": "Engine RPM",   "candidates": ["rpm", "engine_rpm", "rev"], "max": 9000},
        "temp":    {"label": "Coolant Temp (°C)", "candidates": ["coolant_temp", "ect", "temp", "temperature"], "max": 150},
        "throttle":{"label": "Throttle (%)", "candidates": ["throttle", "throttle_pos", "tps"], "max": 100},
        "fuel":    {"label": "Fuel (%)",     "candidates": ["fuel", "fuel_level", "fuel_pct"], "max": 100},
    }

    def __init__(self, parent=None):
        super().__init__(parent)
        self._headers: List[str] = []
        self._rows: List[List[str]] = []
        self._col_map: Dict[str, int] = {}

        self._title = QLabel("Dashboard")
        self._title.setStyleSheet("font-size: 20px; font-weight: bold; margin-bottom: 8px;")

        # Build gauge-like progress bars
        self._bars: Dict[str, QProgressBar] = {}
        self._value_labels: Dict[str, QLabel] = {}

        column = QVBoxLayout()
        column.addWidget(self._title)

        for key, cfg in self.COMMON_SIGNALS.items():
            wrap = QFrame()
            wrap.setFrameShape(QFrame.StyledPanel)
            lay = QVBoxLayout(wrap)
            label = QLabel(cfg["label"])
            label.setStyleSheet("font-weight: 600;")
            bar = QProgressBar()
            bar.setRange(0, cfg["max"])
            bar.setFormat("%v / %m")
            val = QLabel("--")
            val.setStyleSheet("color: #666;")
            lay.addWidget(label)
            lay.addWidget(bar)
            lay.addWidget(val)
            column.addWidget(wrap)
            self._bars[key] = bar
            self._value_labels[key] = val

        column.addStretch(1)
        self.setLayout(column)

    def set_data(self, headers: List[str], rows: List[List[str]]):
        self._headers = headers or []
        self._rows = rows or []
        self._build_column_map()
        # Default to last row on new data
        self._refresh_row(len(self._rows) - 1 if self._rows else None)

    def set_row_index(self, row_index: Optional[int]):
        """Update gauges based on a specific row index (None clears)."""
        self._refresh_row(row_index)

    def _build_column_map(self):
        self._col_map.clear()
        lower_headers = [h.lower() for h in self._headers]
        for key, cfg in self.COMMON_SIGNALS.items():
            idx = -1
            for name in cfg["candidates"]:
                if name in lower_headers:
                    idx = lower_headers.index(name)
                    break
                # try partial includes
                for i, h in enumerate(lower_headers):
                    if name in h:
                        idx = i
                        break
                if idx != -1:
                    break
            if idx != -1:
                self._col_map[key] = idx

    def _refresh_row(self, row_index: Optional[int]):
        if not self._rows or row_index is None or row_index < 0 or row_index >= len(self._rows):
            for key, bar in self._bars.items():
                bar.setValue(0)
                self._value_labels[key].setText("--")
            return

        last = self._rows[row_index]
        for key, cfg in self.COMMON_SIGNALS.items():
            val = None
            if key in self._col_map:
                col = self._col_map[key]
                if col < len(last):
                    val = try_float(str(last[col]))
            # Update UI
            bar = self._bars[key]
            label = self._value_labels[key]
            if val is None:
                bar.setValue(0)
                label.setText("--")
            else:
                maximum = bar.maximum()
                bar.setValue(int(max(0, min(maximum, val))))
                label.setText(f"{val:.2f}")


# ----------------------------
# Table View Widget
# ----------------------------

class TableViewWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._table = QTableView(self)
        self._model = CsvTableModel([], [])
        self._table.setModel(self._model)
        self._table.setSortingEnabled(True)
        self._table.setAlternatingRowColors(True)
        self._table.horizontalHeader().setStretchLastSection(True)
        self._table.setSelectionBehavior(QTableView.SelectRows)
        self._table.setSelectionMode(QTableView.SingleSelection)

        layout = QVBoxLayout(self)
        layout.addWidget(self._table)

    def set_data(self, headers: List[str], rows: List[List[str]]):
        self._model.set_data(headers, rows)

    def select_row(self, row: int):
        if row < 0 or row >= self._model.rowCount():
            self._table.clearSelection()
            return
        sel_model = self._table.selectionModel()
        index0 = self._model.index(row, 0)
        if sel_model is not None and index0.isValid():
            sel_model.setCurrentIndex(index0, QItemSelectionModel.ClearAndSelect | QItemSelectionModel.Rows)
            self._table.scrollTo(index0, QTableView.PositionAtCenter)


# ----------------------------
# Secondary window for CSV (like open-csv-window in Electron main.js)
# ----------------------------

class CsvWindow(QMainWindow):
    def __init__(self, headers: List[str], rows: List[List[str]], parent=None):
        super().__init__(parent)
        self.setWindowTitle("CSV Viewer")
        self.resize(900, 600)

        self._table = TableViewWidget(self)
        self.setCentralWidget(self._table)
        self._table.set_data(headers, rows)


# ----------------------------
# Main Window (translation of main.js + renderer entry points)
# ----------------------------

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("DAQ Interface 26 - Python")
        self.resize(1000, 700)
        self._headers: List[str] = []
        self._rows: List[List[str]] = []
        self._current_row: int = -1
        self._time_col: Optional[int] = None
        self._time_label_key: Optional[str] = None  # 'lap' or 'time'

        # Sidebar
        self._btn_dashboard = QPushButton("Dashboard")
        self._btn_table = QPushButton("Table")
        # New: Load CSV button for quick file selection
        self._btn_load_csv = QPushButton("Load CSV")
        for b in (self._btn_dashboard, self._btn_table):
            b.setCheckable(True)
        self._btn_dashboard.setChecked(True)

        sidebar = QFrame()
        sidebar.setObjectName("sidebar")
        sidebar.setFixedWidth(160)
        side_layout = QVBoxLayout(sidebar)
        side_layout.addWidget(self._btn_dashboard)
        side_layout.addWidget(self._btn_table)
        side_layout.addWidget(self._btn_load_csv)
        side_layout.addStretch(1)

        # Stacked central views
        self._dashboard = DashboardWidget()
        self._table_view = TableViewWidget()
        self._stack_host = QWidget()
        self._stack = QStackedLayout(self._stack_host)
        self._stack.addWidget(self._dashboard)  # index 0
        self._stack.addWidget(self._table_view) # index 1

        # Time controls (slider + labels)
        controls = QWidget()
        controls_layout = QHBoxLayout(controls)
        controls_layout.setContentsMargins(8, 8, 8, 8)
        self._time_label_desc = QLabel("Row:")
        self._time_value_label = QLabel("--")
        self._slider = QSlider(Qt.Horizontal)
        self._slider.setEnabled(False)
        self._slider.setMinimum(0)
        self._slider.setMaximum(0)
        self._slider.setSingleStep(1)
        self._slider.setPageStep(50)
        controls_layout.addWidget(self._time_label_desc)
        controls_layout.addWidget(self._time_value_label)
        controls_layout.addWidget(self._slider, 1)

        # Center column with controls + stack
        center = QWidget()
        center_layout = QVBoxLayout(center)
        center_layout.addWidget(controls)
        center_layout.addWidget(self._stack_host, 1)

        # Root layout
        root = QWidget()
        main_layout = QHBoxLayout(root)
        main_layout.addWidget(sidebar)
        main_layout.addWidget(center, 1)
        self.setCentralWidget(root)

        # Menu actions
        act_open = QAction("Open CSV...", self)
        act_open.triggered.connect(self._action_open_csv)

        act_open_new_win = QAction("Open CSV in New Window", self)
        act_open_new_win.triggered.connect(self._action_open_csv_window)

        act_exit = QAction("Exit", self)
        act_exit.triggered.connect(self.close)

        menubar = self.menuBar()
        file_menu = menubar.addMenu("&File")
        file_menu.addAction(act_open)
        file_menu.addAction(act_open_new_win)
        file_menu.addSeparator()
        file_menu.addAction(act_exit)

        # Status bar
        self.statusBar().showMessage("Ready")

        # Connections
        self._btn_dashboard.clicked.connect(lambda: self._switch_view(0))
        self._btn_table.clicked.connect(lambda: self._switch_view(1))
        self._btn_load_csv.clicked.connect(self._action_open_csv)
        self._slider.valueChanged.connect(self._on_slider_changed)

        # Allow drag & drop of CSV files directly onto the window
        self.setAcceptDrops(True)

        # Simple styles (Qt style sheets; not using the React CSS directly)
        self._apply_basic_style()

    def _apply_basic_style(self):
        self.setStyleSheet("""
            QMainWindow { 
                background: #1e1e24; 
                color: #e0e0e0; 
            }
            #sidebar { 
                background: #141419; 
            }
            QPushButton {
                color: #e0e0e0; 
                background: #2b2b34; 
                border: 1px solid #303038; 
                padding: 10px; 
                margin: 6px; 
                border-radius: 4px; 
                text-align: left;
            }
            QPushButton:checked { 
                background: #3d5afe; 
                border-color: #3d5afe; 
            }
            QPushButton:hover { 
                background: #373743; 
            }
            QFrame[frameShape="5"] { 
                background: #23232a; 
                border: 1px solid #303038; 
                border-radius: 6px; 
            }
            QProgressBar { 
                border: 1px solid #303038; 
                border-radius: 3px; 
                background: #2b2b34; 
                color: #e0e0e0; 
                text-align: center; 
            }
            QProgressBar::chunk { 
                background-color: #03dac6; 
            }
            QTableView { 
                background: #202027; 
                color: #e0e0e0; 
                gridline-color: #303038; 
                alternate-background-color: #25252d; 
                selection-background-color: #3d5afe; 
                selection-color: #ffffff; 
            }
            QHeaderView::section { 
                background: #2b2b34; 
                color: #e0e0e0; 
                padding: 4px 6px; 
                border: none; 
            }
            QScrollBar:vertical, QScrollBar:horizontal {
                background: #1e1e24; 
                border: 1px solid #303038; 
            }
            QLabel { color: #e0e0e0; }
        """)

    def _switch_view(self, idx: int):
        self._stack.setCurrentIndex(idx)
        self._btn_dashboard.setChecked(idx == 0)
        self._btn_table.setChecked(idx == 1)

    # File actions

    def _action_open_csv(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Open CSV", os.getcwd(), "CSV Files (*.csv);;All Files (*.*)"
        )
        if not path:
            return
        self._load_csv(path)

    def _action_open_csv_window(self):
        if not self._headers or not self._rows:
            QMessageBox.information(self, "No Data", "Load a CSV file first.")
            return
        win = CsvWindow(self._headers, self._rows, self)
        win.show()

    def _load_csv(self, path: str):
        try:
            headers, rows = load_csv(path)
        except Exception as ex:
            QMessageBox.critical(self, "Error", f"Failed to load CSV:\n{ex}")
            return

        self._headers, self._rows = headers, rows
        # Identify time column and configure slider
        self._time_col, self._time_label_key = self._find_time_column(self._headers)
        total = len(self._rows)
        self._slider.setEnabled(total > 0)
        self._slider.setMinimum(0)
        self._slider.setMaximum(max(0, total - 1))
        self._current_row = total - 1 if total > 0 else -1
        self._table_view.set_data(headers, rows)
        self._dashboard.set_data(headers, rows)
        if total > 0:
            self._slider.blockSignals(True)
            self._slider.setValue(self._current_row)
            self._slider.blockSignals(False)
        self._update_time_display(self._current_row)
        self._apply_row_selection()
        self.statusBar().showMessage(f"Loaded {len(rows)} rows from: {os.path.basename(path)}")

    def _on_slider_changed(self, value: int):
        self._current_row = int(value)
        self._update_time_display(self._current_row)
        self._apply_row_selection()

    def _apply_row_selection(self):
        self._dashboard.set_row_index(self._current_row)
        self._table_view.select_row(self._current_row)

    def _find_time_column(self, headers: List[str]) -> Tuple[Optional[int], Optional[str]]:
        """Return (index, key) where key is 'lap' or 'time', or (None,None) if not found."""
        if not headers:
            return None, None
        lowers = [h.lower() for h in headers]
        lap_candidates = ["lap", "lap_number", "lap no", "lap#"]
        time_candidates = [
            "time", "timestamp", "time_ms", "time_s", "time (s)", "t", "t[s]", "seconds", "ms", "millis"
        ]
        for name in lap_candidates:
            for i, h in enumerate(lowers):
                if name == h or name in h:
                    return i, "lap"
        for name in time_candidates:
            for i, h in enumerate(lowers):
                if name == h or name in h:
                    return i, "time"
        return None, None

    def _update_time_display(self, row_index: int):
        total = len(self._rows)
        if row_index is None or row_index < 0 or row_index >= total or total == 0:
            self._time_label_desc.setText("Row:")
            self._time_value_label.setText("--")
            return
        if self._time_label_key == "lap":
            self._time_label_desc.setText("Lap:")
        elif self._time_label_key == "time":
            self._time_label_desc.setText("Time:")
        else:
            self._time_label_desc.setText("Row:")

        if self._time_col is not None and self._time_col < len(self._rows[row_index]):
            val_text = str(self._rows[row_index][self._time_col])
        else:
            val_text = f"{row_index + 1}/{total}"
        self._time_value_label.setText(val_text)

    # Drag & drop support
    def dragEnterEvent(self, event):  # type: ignore
        if event.mimeData().hasUrls():
            # Accept if any url ends with .csv
            for url in event.mimeData().urls():
                if url.toLocalFile().lower().endswith('.csv'):
                    event.acceptProposedAction()
                    return
        event.ignore()

    def dropEvent(self, event):  # type: ignore
        paths = [u.toLocalFile() for u in event.mimeData().urls() if u.isLocalFile()]
        csv_paths = [p for p in paths if p.lower().endswith('.csv')]
        if not csv_paths:
            self.statusBar().showMessage("Dropped files are not CSV")
            event.ignore()
            return
        # Use first CSV
        self._load_csv(csv_paths[0])
        event.acceptProposedAction()


# ----------------------------
# App entry
# ----------------------------

def main():
    app = QApplication(sys.argv)
    win = MainWindow()
    win.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()