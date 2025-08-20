import * as net from 'net';

export class PortManager {
    
    static async findAvailablePort(startPort: number = 8080): Promise<number> {
        return new Promise((resolve) => {
            const checkPort = (port: number) => {
                const server = net.createServer();
                
                server.listen(port, () => {
                    server.close(() => {
                        resolve(port);
                    });
                });
                
                server.on('error', () => {
                    checkPort(port + 1);
                });
            };
            
            checkPort(startPort);
        });
    }

    static async findAvailablePortRange(startPort: number = 8080, count: number = 2): Promise<number[]> {
        const ports: number[] = [];
        let currentPort = startPort;
        
        for (let i = 0; i < count; i++) {
            const availablePort = await this.findAvailablePort(currentPort);
            ports.push(availablePort);
            currentPort = availablePort + 1;
        }
        
        return ports;
    }

    static generateRandomPassword(length: number = 16): string {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
}
