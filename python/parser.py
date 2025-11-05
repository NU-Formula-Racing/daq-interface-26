# DBC Parser
from socket import socket

class DataSource:
    def __init__(self):
        pass

# change
    def is_data_available(self):
        pass

    def get_data(self):
        pass

class StaticDS(DataSource):
    def __init__(self, path):
        super().__init__()
        with open(path, 'r') as file:
            self.data = file.read()

    def is_data_available(self):
        return bool(self.data)

    def get_data(self):
        return self.data
    
class WirelessDS(DataSource):
    def __init__(self, host, port):
        super().__init__()
        import socket
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind((host, port))
        self.sock.settimeout(1.0)
        self.buffer = ""

    def is_data_available(self):
        try:
            data, _ = self.sock.recvfrom(4096)
            self.buffer += data.decode('utf-8')
            return True
        except socket.timeout:
            return False

    def get_data(self):
        if '\n' in self.buffer:
            line, self.buffer = self.buffer.split('\n', 1)
            return line
        return None

# New: USB data source that can read from a CSV file on an SD card (mounted filesystem)
# or from a live USB serial stream (e.g. using a USB-serial adapter).
try:
    import serial
except Exception:
    serial = None

class USBDS(DataSource):
    """
    mode: 'file' or 'serial'
    - file: path -> path to CSV file on mounted SD card. File is read line-by-line.
            If file is being appended by another process, new lines will be picked up
            on subsequent calls to is_data_available().
    - serial: port + baud -> use pyserial to read live newline-terminated lines from the device.
    """
    def __init__(self, mode, path=None, port=None, baud=115200, timeout=0.1, encoding='utf-8'):
        super().__init__()
        self.mode = mode
        self.encoding = encoding
        self._next_line = None

        if mode == 'file':
            if not path:
                raise ValueError("path is required for file mode")
            # open in text mode, leave open so we can tail if file grows
            self.file = open(path, 'r', encoding=self.encoding, errors='replace')
            # start at beginning; if you prefer tailing only new writes, uncomment:
            # self.file.seek(0, 2)
            self._closed = False
        elif mode == 'serial':
            if serial is None:
                raise RuntimeError("pyserial is required for serial mode (install with 'pip install pyserial')")
            if not port:
                raise ValueError("port is required for serial mode")
            self.ser = serial.Serial(port, baudrate=baud, timeout=timeout)
            # small internal buffer for partial reads
            self._buffer = ""
            self._closed = False
        else:
            raise ValueError("mode must be 'file' or 'serial'")

    def is_data_available(self):
        if self.mode == 'file':
            if self._next_line is not None:
                return True
            # Attempt to read the next line. readline() returns '' at EOF.
            line = self.file.readline()
            if line == '':
                return False
            # strip trailing newline characters but preserve CSV structure otherwise
            self._next_line = line.rstrip('\r\n')
            return True

        elif self.mode == 'serial':
            if self._next_line is not None:
                return True
            # If bytes are available, read a line. readline respects the serial timeout.
            try:
                # in_waiting quick check to avoid blocking on some platforms
                if getattr(self.ser, 'in_waiting', 0) == 0:
                    return False
                raw = self.ser.readline()  # reads until newline or timeout
                if not raw:
                    return False
                self._next_line = raw.decode(self.encoding, errors='replace').rstrip('\r\n')
                return True
            except Exception:
                # On serial errors treat as no data available; caller can recreate source
                return False

    def get_data(self):
        if self._next_line is None:
            # try to fetch if possible (non-blocking)
            if not self.is_data_available():
                return None
        line = self._next_line
        self._next_line = None
        return line

    def close(self):
        if getattr(self, '_closed', False):
            return
        if self.mode == 'file':
            try:
                self.file.close()
            except Exception:
                pass
        elif self.mode == 'serial':
            try:
                self.ser.close()
            except Exception:
                pass
        self._closed = True

    # convenience context-manager support
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()