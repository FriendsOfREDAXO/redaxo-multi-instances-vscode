/** PHP snippet executed in the web container – returns query results as JSON. */
export const QUERY_SCRIPT = String.raw`
$sql = (string) getenv('RMI_SQL');
$ro = getenv('RMI_RO') === '1';
$max = max(1, (int) getenv('RMI_MAX'));
try {
    $multi = class_exists('Pdo\\Mysql') ? Pdo\Mysql::ATTR_MULTI_STATEMENTS : PDO::MYSQL_ATTR_MULTI_STATEMENTS;
    $pdo = new PDO((string) getenv('RMI_DSN'), (string) getenv('RMI_USER'), (string) getenv('RMI_PASS'), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        $multi => false,
    ]);
    $pdo->exec('SET NAMES utf8mb4');
    if ($ro) {
        $pdo->exec('SET SESSION TRANSACTION READ ONLY');
        $pdo->beginTransaction();
    }
    $st = $pdo->query($sql);
    $cols = [];
    for ($i = 0; $i < $st->columnCount(); $i++) {
        $meta = $st->getColumnMeta($i);
        $cols[] = $meta['name'] ?? ('col' . $i);
    }
    $rows = [];
    $truncated = false;
    if ($st->columnCount() > 0) {
        while (($row = $st->fetch(PDO::FETCH_NUM)) !== false) {
            if (count($rows) >= $max) { $truncated = true; break; }
            $rows[] = $row;
        }
    }
    if ($ro && $pdo->inTransaction()) { $pdo->rollBack(); }
    echo json_encode(['ok' => true, 'columns' => $cols, 'rows' => $rows, 'rowCount' => $st->rowCount(), 'truncated' => $truncated],
        JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
} catch (Throwable $e) {
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
`;

export interface QueryResult {
    columns: string[];
    rows: Array<Array<string | number | null>>;
    rowCount: number;
    truncated: boolean;
}

const READ_ONLY_START = /^\s*(?:\/\*[\s\S]*?\*\/\s*)*(select|show|describe|desc|explain|with)\b/i;

export function isReadOnlyStatement(sql: string): boolean {
    return READ_ONLY_START.test(sql) && !/;\s*\S/.test(sql.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, ''));
}

/** Database names: letters, digits, `_` and `-` (1.x custom instances use the instance name). */
export function isValidIdentifier(name: string): boolean {
    return /^[A-Za-z0-9_-]{1,64}$/.test(name);
}

/** Renders a result as a Markdown table (chat / LM tools). */
export function resultToMarkdown(result: QueryResult, maxRows = 50): string {
    if (result.columns.length === 0) {
        return `OK – ${result.rowCount} row(s) affected.`;
    }
    const esc = (v: unknown) => (v === null ? 'NULL' : String(v)).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 200);
    const rows = result.rows.slice(0, maxRows);
    const lines = [
        `| ${result.columns.map(esc).join(' | ')} |`,
        `| ${result.columns.map(() => '---').join(' | ')} |`,
        ...rows.map(r => `| ${r.map(esc).join(' | ')} |`),
    ];
    const more = result.rows.length > rows.length || result.truncated;
    return lines.join('\n') + (more ? `\n\n_${result.rows.length}${result.truncated ? '+' : ''} rows, showing ${rows.length}._` : '');
}

/** Databases that are never exported or listed. */
export const systemDatabases: ReadonlySet<string> = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);
