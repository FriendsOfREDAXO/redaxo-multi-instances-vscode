import * as assert from 'assert';
import { DockerComposeGenerator } from '../docker/dockerCompose';
import { CreateInstanceOptions } from '../types/redaxo';

suite('Docker Compose SSL Configuration Test Suite', () => {
    
    test('SSL volumes should mount to /etc/apache2/ssl to preserve CA certificates', () => {
        const options: CreateInstanceOptions = {
            name: 'test-instance',
            phpVersion: '8.3',
            mariadbVersion: '10.11',
            autoInstall: false,
            importDump: false,
            webserverOnly: false,
            releaseType: 'standard',
            imageVariant: 'stable'
        };
        
        const dockerCompose = DockerComposeGenerator.generate(
            options,
            'testpass',
            'rootpass',
            8080,
            8443,
            3306,
            8081, // phpmyadminPort
            true // SSL enabled
        );
        
        // Verify SSL volume is mounted to /etc/apache2/ssl instead of /etc/ssl/certs
        assert.ok(dockerCompose.includes('- ./ssl:/etc/apache2/ssl:ro'), 
            'SSL certificates should be mounted to /etc/apache2/ssl to preserve system CA certificates');
        
        // Verify old problematic mounts are NOT present
        assert.ok(!dockerCompose.includes('/etc/ssl/certs'), 
            'SSL certificates should NOT be mounted to /etc/ssl/certs as it overwrites CA certificates');
        
        assert.ok(!dockerCompose.includes('/etc/ssl/private'), 
            'SSL certificates should NOT be mounted to /etc/ssl/private as it overwrites CA certificates');
    });

    test('Non-SSL configuration should not include SSL volumes', () => {
        const options: CreateInstanceOptions = {
            name: 'test-instance-no-ssl',
            phpVersion: '8.3', 
            mariadbVersion: '10.11',
            autoInstall: false,
            importDump: false,
            webserverOnly: false,
            releaseType: 'standard',
            imageVariant: 'stable'
        };
        
        const dockerCompose = DockerComposeGenerator.generate(
            options,
            'testpass',
            'rootpass', 
            8080,
            8443,
            3307,
            8082, // phpmyadminPort
            false // SSL disabled
        );
        
        // Verify no SSL volume mounts when SSL is disabled
        assert.ok(!dockerCompose.includes('/etc/apache2/ssl'), 
            'SSL volumes should not be present when SSL is disabled');
    });
});