import * as assert from 'assert';
import { DatabaseQueryService } from '../docker/databaseQueryService';

suite('DatabaseQueryService basic checks', () => {
    test('query returns error when container is not running', async () => {
        const mock = {
            isContainerRunning: async (_: string) => false,
            getDbContainerName: async (_: string) => null
        } as any;

        DatabaseQueryService.initialize(mock);

        const result = await DatabaseQueryService.query('nonexistent', 'SELECT 1');
        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('not running') || result.error?.includes('not available'));
    });
});
