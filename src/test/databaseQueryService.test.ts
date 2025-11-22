import * as assert from 'assert';
import { DatabaseQueryService } from '../docker/databaseQueryService';

suite('DatabaseQueryService Export/Import Tests', () => {

    test('exportDatabase returns failure when DB container not found', async () => {
        // Provide a mock dockerService without a DB container
        const mock = {
            getDbContainerName: async (_: string) => null
        } as any;

        DatabaseQueryService.initialize(mock);

        const result = await DatabaseQueryService.exportDatabase('nonexistent', '/tmp/dump.sql');
        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('Database container not found'));
    });

    test('importDatabase returns failure when DB container not found', async () => {
        const mock = {
            getDbContainerName: async (_: string) => null
        } as any;

        DatabaseQueryService.initialize(mock);

        const result = await DatabaseQueryService.importDatabase('nonexistent', '/tmp/dump.sql');
        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('Database container not found'));
    });

});
