import * as net from 'net';
import { execSync } from 'child_process';

export class PortManager {
    
    /**
     * Prüft alle aktuell verwendeten Ports (inklusive Docker-Container)
     */
    static getUsedPorts(): number[] {
        const usedPorts: number[] = [];
        
        try {
            // Prüfe lokale Ports
            const netstatOutput = execSync('netstat -an | grep LISTEN', { encoding: 'utf8' });
            const lines = netstatOutput.split('\n');
            
            for (const line of lines) {
                const match = line.match(/:(\d+)\s/);
                if (match) {
                    const port = parseInt(match[1]);
                    if (port >= 8000 && port <= 9999) { // Nur relevante Port-Range
                        usedPorts.push(port);
                    }
                }
            }
        } catch (error) {
            // Fallback: Verwende nur grundlegende Port-Checks
        }

        try {
            // Prüfe Docker-Container Ports
            const dockerOutput = execSync('docker ps --format "table {{.Ports}}" 2>/dev/null || true', { encoding: 'utf8' });
            const lines = dockerOutput.split('\n').slice(1); // Überspringe Header
            
            for (const line of lines) {
                const portMatches = line.match(/(\d+):/g);
                if (portMatches) {
                    for (const match of portMatches) {
                        const port = parseInt(match.replace(':', ''));
                        if (port >= 8000 && port <= 9999) {
                            usedPorts.push(port);
                        }
                    }
                }
            }
        } catch (error) {
            // Docker nicht verfügbar oder Fehler - verwende nur net-basierte Checks
        }
        
        return [...new Set(usedPorts)]; // Duplikate entfernen
    }
    
    static async findAvailablePort(startPort: number = 8080): Promise<number> {
        const usedPorts = this.getUsedPorts();
        
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 100; // Verhindere Endlosschleifen
            
            const checkPort = (port: number) => {
                if (attempts >= maxAttempts) {
                    reject(new Error(`Could not find available port after ${maxAttempts} attempts`));
                    return;
                }
                
                attempts++;
                
                // Überspringe bekannte System-Ports, häufig verwendete Ports und bereits verwendete Ports
                if (this.isReservedPort(port) || usedPorts.includes(port)) {
                    checkPort(port + 1);
                    return;
                }
                
                const server = net.createServer();
                
                server.listen(port, '0.0.0.0', () => {
                    server.close(() => {
                        resolve(port);
                    });
                });
                
                server.on('error', (err: any) => {
                    if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
                        checkPort(port + 1);
                    } else {
                        checkPort(port + 1);
                    }
                });
            };
            
            checkPort(startPort);
        });
    }

    private static isReservedPort(port: number): boolean {
        // Bekannte System-Ports und häufig verwendete Ports überspringen
        const reservedPorts = [
            22, 25, 53, 80, 110, 143, 443, 993, 995, // Standard System-Ports
            3000, 3001, 4000, 5000, 5173, 8000, 8001, // Häufige Development-Ports
            3306, 5432, 27017, 6379, // Datenbank-Ports
            9000, 9001, 9002 // Weitere häufige Ports
        ];
        
        return reservedPorts.includes(port);
    }

    static async findAvailablePortRange(startPort: number = 8080, count: number = 2): Promise<number[]> {
        const ports: number[] = [];
        let currentPort = startPort;
        
        for (let i = 0; i < count; i++) {
            const availablePort = await this.findAvailablePort(currentPort);
            ports.push(availablePort);
            // Nächsten Port mit etwas Abstand suchen, um Konflikte zu vermeiden
            currentPort = availablePort + 10; 
        }
        
        return ports;
    }

    /**
     * Findet einen freien Port-Range für eine komplette REDAXO-Instanz
     * @param startPort Startport für die Suche
     * @returns Object mit HTTP, HTTPS, MySQL und PHPMyAdmin Port
     */
    static async findInstancePortRange(startPort: number = 8080): Promise<{
        http: number;
        https: number;
        mysql: number;
        phpmyadmin: number;
    }> {
        const [httpPort, httpsPort, mysqlPort, phpmyadminPort] = await this.findAvailablePortRange(startPort, 4);
        
        return {
            http: httpPort,
            https: httpsPort,
            mysql: mysqlPort,
            phpmyadmin: phpmyadminPort
        };
    }

    static generateRandomPassword(length: number = 16): string {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    /**
     * Zeigt alle aktuell verwendeten Ports im relevanten Bereich an
     */
    static showPortUsage(): void {
        const usedPorts = this.getUsedPorts();
        console.log('🌐 Aktuell verwendete Ports (8000-9999):');
        if (usedPorts.length === 0) {
            console.log('   ✅ Keine Ports im Bereich 8000-9999 in Verwendung');
        } else {
            usedPorts.sort((a, b) => a - b).forEach(port => {
                console.log(`   📌 Port ${port} ist in Verwendung`);
            });
        }
    }
}
