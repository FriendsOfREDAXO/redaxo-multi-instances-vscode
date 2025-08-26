import * as assert from 'assert';
import { SSLManager } from '../docker/sslManager';

suite('SSL Manager Configuration Test Suite', () => {
    
    test('Apache SSL config should reference /etc/apache2/ssl paths', () => {
        // Access the private method via type assertion for testing
        const sslConfigMethod = (SSLManager as any).generateApacheSSLConfig;
        const apacheConfig = sslConfigMethod('test-instance', 'standard');
        
        // Verify certificate paths point to /etc/apache2/ssl
        assert.ok(apacheConfig.includes('SSLCertificateFile /etc/apache2/ssl/test-instance.pem'), 
            'SSL certificate file should reference /etc/apache2/ssl path');
            
        assert.ok(apacheConfig.includes('SSLCertificateKeyFile /etc/apache2/ssl/test-instance-key.pem'), 
            'SSL certificate key file should reference /etc/apache2/ssl path');
        
        // Verify old problematic paths are NOT used
        assert.ok(!apacheConfig.includes('/etc/ssl/certs/'), 
            'SSL config should NOT reference /etc/ssl/certs as it conflicts with CA certificates');
            
        assert.ok(!apacheConfig.includes('/etc/ssl/private/'), 
            'SSL config should NOT reference /etc/ssl/private as it conflicts with CA certificates');
    });
    
    test('Apache SSL config should contain security headers', () => {
        const sslConfigMethod = (SSLManager as any).generateApacheSSLConfig;
        const apacheConfig = sslConfigMethod('test-instance', 'standard');
        
        // Verify essential security headers are present
        assert.ok(apacheConfig.includes('Header always set Strict-Transport-Security'), 
            'HSTS header should be configured');
            
        assert.ok(apacheConfig.includes('Header always set X-Frame-Options DENY'), 
            'X-Frame-Options header should be configured');
            
        assert.ok(apacheConfig.includes('Header always set X-Content-Type-Options nosniff'), 
            'X-Content-Type-Options header should be configured');
    });
});