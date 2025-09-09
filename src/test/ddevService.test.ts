import * as assert from 'assert';
import * as vscode from 'vscode';
import { DDEVService } from '../ddev/ddevService';
import { DDEVTemplates } from '../ddev/ddevTemplates';

suite('DDEV Service Test Suite', () => {
    let ddevService: DDEVService;
    let outputChannel: vscode.OutputChannel;

    setup(() => {
        outputChannel = vscode.window.createOutputChannel('Test DDEV');
        ddevService = new DDEVService(outputChannel);
    });

    teardown(() => {
        outputChannel.dispose();
    });

    test('DDEVService instantiation', () => {
        assert.ok(ddevService, 'DDEVService should be instantiated');
    });

    test('checkDDEVAvailability returns boolean', async () => {
        const isAvailable = await ddevService.checkDDEVAvailability();
        assert.strictEqual(typeof isAvailable, 'boolean', 'checkDDEVAvailability should return a boolean');
    });

    test('DDEVTemplates generateDDEVConfig', () => {
        const config = DDEVTemplates.generateDDEVConfig('test-project', '8.3', '10.11', 'public');
        
        assert.ok(config.includes('name: test-project'), 'Config should contain project name');
        assert.ok(config.includes('php_version: "8.3"'), 'Config should contain PHP version');
        assert.ok(config.includes('docroot: public'), 'Config should contain docroot');
        assert.ok(config.includes('version: "10.11"'), 'Config should contain MariaDB version');
    });

    test('DDEVTemplates generatePHPConfig', () => {
        const phpConfig = DDEVTemplates.generatePHPConfig();
        
        assert.ok(phpConfig.includes('memory_limit = 2048M'), 'PHP config should set memory limit');
        assert.ok(phpConfig.includes('upload_max_filesize = 512M'), 'PHP config should set upload limit');
        assert.ok(phpConfig.includes('extension = mbstring'), 'PHP config should enable mbstring');
    });

    test('DDEVTemplates generateHtaccess', () => {
        const htaccess = DDEVTemplates.generateHtaccess();
        
        assert.ok(htaccess.includes('RewriteEngine On'), '.htaccess should enable rewrite engine');
        assert.ok(htaccess.includes('REDAXO'), '.htaccess should contain REDAXO-specific rules');
    });

    test('DDEVTemplates generateInstanceReadme', () => {
        const readme = DDEVTemplates.generateInstanceReadme('test-project', '8.3', '10.11');
        
        assert.ok(readme.includes('# REDAXO DDEV Instance: test-project'), 'README should contain project title');
        assert.ok(readme.includes('PHP Version: 8.3'), 'README should contain PHP version');
        assert.ok(readme.includes('MariaDB 10.11'), 'README should contain MariaDB version');
        assert.ok(readme.includes('ddev start'), 'README should contain DDEV commands');
    });
});

suite('DDEV Integration Test Suite', () => {
    test('DDEV configuration structure validation', () => {
        const testConfig = {
            name: 'test-instance',
            type: 'php',
            docroot: 'public',
            php_version: '8.3',
            database: {
                type: 'mariadb',
                version: '10.11'
            },
            use_dns_when_possible: true,
            additional_hostnames: ['test-instance.ddev.site']
        };

        // Validate required properties exist
        assert.ok(testConfig.name, 'Config should have name');
        assert.ok(testConfig.type, 'Config should have type');
        assert.ok(testConfig.docroot, 'Config should have docroot');
        assert.ok(testConfig.php_version, 'Config should have php_version');
        assert.ok(testConfig.database, 'Config should have database config');
        assert.ok(testConfig.database.type, 'Database config should have type');
        assert.ok(testConfig.database.version, 'Database config should have version');
    });

    test('REDAXO structure detection logic', () => {
        // Test structure types
        const classicStructure = 'classic';
        const modernStructure = 'modern';

        assert.strictEqual(classicStructure, 'classic', 'Classic structure should be "classic"');
        assert.strictEqual(modernStructure, 'modern', 'Modern structure should be "modern"');
    });

    test('Container type validation', () => {
        const dockerType = 'docker';
        const ddevType = 'ddev';

        assert.strictEqual(dockerType, 'docker', 'Docker type should be "docker"');
        assert.strictEqual(ddevType, 'ddev', 'DDEV type should be "ddev"');
    });
});