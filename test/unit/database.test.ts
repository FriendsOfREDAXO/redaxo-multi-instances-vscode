import * as assert from 'node:assert/strict';
import { isReadOnlyStatement, isValidIdentifier, resultToMarkdown } from '../../src/core/database';

describe('database helpers', () => {
    it('detects read-only statements', () => {
        for (const sql of ['SELECT 1', '  select * from rex_article', 'SHOW TABLES', 'DESCRIBE rex_user', 'EXPLAIN SELECT 1',
            'WITH x AS (SELECT 1) SELECT * FROM x', '/* c */ SELECT 1', "SELECT 'a;b'", 'SELECT 1;']) {
            assert.ok(isReadOnlyStatement(sql), sql);
        }
        for (const sql of ['DELETE FROM rex_user', 'UPDATE x SET a=1', 'SELECT 1; DROP TABLE x', 'DROP TABLE x', 'INSERT INTO x VALUES (1)']) {
            assert.ok(!isReadOnlyStatement(sql), sql);
        }
    });

    it('accepts database names of 1.x custom instances', () => {
        assert.ok(isValidIdentifier('redaxo'));
        assert.ok(isValidIdentifier('legacy-custom'));
        assert.ok(!isValidIdentifier('a`b'));
        assert.ok(!isValidIdentifier("a'; DROP"));
    });

    it('renders Markdown tables', () => {
        const md = resultToMarkdown({ columns: ['id', 'name'], rows: [[1, 'a|b'], [2, null]], rowCount: 2, truncated: false });
        assert.match(md, /\| id \| name \|/);
        assert.match(md, /a\\\|b/);
        assert.match(md, /NULL/);
        assert.equal(resultToMarkdown({ columns: [], rows: [], rowCount: 3, truncated: false }), 'OK – 3 row(s) affected.');
    });
});
