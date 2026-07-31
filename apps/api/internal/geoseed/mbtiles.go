package geoseed

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// MBTiles is a read-only OpenMapTiles SQLite database.
type MBTiles struct {
	db *sql.DB
}

// OpenMBTiles opens path read-only.
func OpenMBTiles(path string) (*MBTiles, error) {
	// mode=ro + immutable for safer concurrent reads of large planet files.
	dsn := fmt.Sprintf("file:%s?mode=ro&_pragma=query_only(1)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open mbtiles: %w", err)
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping mbtiles: %w", err)
	}
	return &MBTiles{db: db}, nil
}

// Close closes the underlying SQLite handle.
func (m *MBTiles) Close() error {
	if m == nil || m.db == nil {
		return nil
	}
	return m.db.Close()
}

// ReadTile returns uncompressed (or still-gzipped — decoder handles both) tile bytes.
// y is XYZ (not TMS); MBTiles stores TMS row.
func (m *MBTiles) ReadTile(z, x, y int) ([]byte, error) {
	tmsY := (1 << z) - 1 - y
	var data []byte
	err := m.db.QueryRow(
		`SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?`,
		z, x, tmsY,
	).Scan(&data)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return data, nil
}

// ListZoomCols returns (tile_column, tile_row TMS) for a zoom level.
func (m *MBTiles) ListZoomCols(z int) ([][2]int, error) {
	rows, err := m.db.Query(
		`SELECT tile_column, tile_row FROM tiles WHERE zoom_level = ?`, z,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out [][2]int
	for rows.Next() {
		var x, tmsY int
		if err := rows.Scan(&x, &tmsY); err != nil {
			return nil, err
		}
		out = append(out, [2]int{x, tmsY})
	}
	return out, rows.Err()
}
