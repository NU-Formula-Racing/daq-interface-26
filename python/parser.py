# DBC Parser
from socket import socket

class DataSource:
    def __init__(self):
        pass

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