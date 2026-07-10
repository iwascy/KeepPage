package repository

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
)

func (r *PostgresRepository) ListFolders(ctx context.Context, userID string) ([]domain.Folder, error) {
	folders, err := loadPostgresFolders(ctx, r.pool, userID)
	if err != nil {
		return nil, err
	}
	return sortedFolders(folders), nil
}

func (r *PostgresRepository) CreateFolder(ctx context.Context, userID string, input domain.FolderCreateRequest) (domain.Folder, error) {
	name, err := validateFolderName(input.Name)
	if err != nil {
		return domain.Folder{}, err
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return domain.Folder{}, err
	}
	defer tx.Rollback(ctx)
	var parent *domain.Folder
	if input.ParentID != nil {
		folders, err := loadPostgresFolders(ctx, tx, userID)
		if err != nil {
			return domain.Folder{}, err
		}
		value, ok := folders[*input.ParentID]
		if !ok {
			return domain.Folder{}, httperror.NotFound("FolderNotFound", "Parent folder not found.")
		}
		parent = &value
	}
	folder := domain.Folder{ID: auth.NewUUID(), Name: name, Path: buildFolderPath(parent, name), ParentID: input.ParentID}
	_, err = tx.Exec(ctx, `
		insert into folders (id, user_id, name, path, parent_id, created_at, updated_at)
		values ($1, $2, $3, $4, $5, $6, $6)
	`, folder.ID, userID, folder.Name, folder.Path, folder.ParentID, time.Now().UTC())
	if err != nil {
		return domain.Folder{}, taxonomyDatabaseError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.Folder{}, err
	}
	return folder, nil
}

func (r *PostgresRepository) UpdateFolder(ctx context.Context, userID string, folderID string, input domain.FolderUpdateRequest) (*domain.Folder, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	folders, err := loadPostgresFolders(ctx, tx, userID)
	if err != nil {
		return nil, err
	}
	updated, affected, err := updateFolderTree(folders, folderID, input)
	if err != nil || updated == nil {
		return updated, err
	}
	now := time.Now().UTC()
	ids := make([]string, 0, len(affected))
	for id := range affected {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return len(folders[ids[i]].Path) > len(folders[ids[j]].Path) })
	for _, id := range ids {
		folder := folders[id]
		if _, err := tx.Exec(ctx, `update folders set name = $2, path = $3, parent_id = $4, updated_at = $5 where id = $1`, folder.ID, folder.Name, folder.Path, folder.ParentID, now); err != nil {
			return nil, taxonomyDatabaseError(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return updated, nil
}

func (r *PostgresRepository) DeleteFolder(ctx context.Context, userID string, folderID string) (bool, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	folders, err := loadPostgresFolders(ctx, tx, userID)
	if err != nil {
		return false, err
	}
	deleted, affected, err := deleteFolderTree(folders, folderID)
	if err != nil || !deleted {
		return deleted, err
	}
	now := time.Now().UTC()
	ids := make([]string, 0, len(affected))
	for id := range affected {
		if id != folderID {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return len(folders[ids[i]].Path) > len(folders[ids[j]].Path) })
	for _, id := range ids {
		folder := folders[id]
		if _, err := tx.Exec(ctx, `update folders set name = $2, path = $3, parent_id = $4, updated_at = $5 where id = $1`, folder.ID, folder.Name, folder.Path, folder.ParentID, now); err != nil {
			return false, taxonomyDatabaseError(err)
		}
	}
	if _, err := tx.Exec(ctx, `delete from folders where id = $1 and user_id = $2`, folderID, userID); err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

func (r *PostgresRepository) ListTags(ctx context.Context, userID string) ([]domain.Tag, error) {
	rows, err := r.pool.Query(ctx, `select id::text, name, color from tags where user_id = $1 order by name asc`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.Tag{}
	for rows.Next() {
		var tag domain.Tag
		if err := rows.Scan(&tag.ID, &tag.Name, &tag.Color); err != nil {
			return nil, err
		}
		items = append(items, tag)
	}
	return items, rows.Err()
}

func (r *PostgresRepository) CreateTag(ctx context.Context, userID string, input domain.TagCreateRequest) (domain.Tag, error) {
	name, err := validateTagName(input.Name)
	if err != nil {
		return domain.Tag{}, err
	}
	color, err := validateTagColor(input.Color)
	if err != nil {
		return domain.Tag{}, err
	}
	tag := domain.Tag{ID: auth.NewUUID(), Name: name, Color: color}
	err = r.pool.QueryRow(ctx, `
		insert into tags (id, user_id, name, color, created_at)
		values ($1, $2, $3, $4, $5)
		returning id::text, name, color
	`, tag.ID, userID, tag.Name, tag.Color, time.Now().UTC()).Scan(&tag.ID, &tag.Name, &tag.Color)
	if err != nil {
		return domain.Tag{}, taxonomyDatabaseError(err)
	}
	return tag, nil
}

func (r *PostgresRepository) UpdateTag(ctx context.Context, userID string, tagID string, input domain.TagUpdateRequest) (*domain.Tag, error) {
	if !input.Name.Present && !input.Color.Present {
		return nil, httperror.BadRequest("ValidationError", "At least one field must be updated.", nil)
	}
	var tag domain.Tag
	err := r.pool.QueryRow(ctx, `select id::text, name, color from tags where id = $1 and user_id = $2`, tagID, userID).Scan(&tag.ID, &tag.Name, &tag.Color)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if input.Name.Present {
		if input.Name.Value == nil {
			return nil, httperror.BadRequest("ValidationError", "name must be a string.", nil)
		}
		tag.Name, err = validateTagName(*input.Name.Value)
		if err != nil {
			return nil, err
		}
	}
	if input.Color.Present {
		tag.Color, err = validateTagColor(input.Color.Value)
		if err != nil {
			return nil, err
		}
	}
	err = r.pool.QueryRow(ctx, `update tags set name = $3, color = $4 where id = $1 and user_id = $2 returning id::text, name, color`, tagID, userID, tag.Name, tag.Color).Scan(&tag.ID, &tag.Name, &tag.Color)
	if err != nil {
		return nil, taxonomyDatabaseError(err)
	}
	return &tag, nil
}

func (r *PostgresRepository) DeleteTag(ctx context.Context, userID string, tagID string) (bool, error) {
	command, err := r.pool.Exec(ctx, `delete from tags where id = $1 and user_id = $2`, tagID, userID)
	return command.RowsAffected() > 0, err
}

func (r *PostgresRepository) GetBookmarkSidebarStats(ctx context.Context, userID string) (domain.BookmarkSidebarStatsResponse, error) {
	rows, err := r.pool.Query(ctx, `select folder_id::text, count(*)::int from bookmarks where user_id = $1 and folder_id is not null group by folder_id`, userID)
	if err != nil {
		return domain.BookmarkSidebarStatsResponse{}, err
	}
	defer rows.Close()
	items := []domain.FolderCount{}
	for rows.Next() {
		var item domain.FolderCount
		if err := rows.Scan(&item.FolderID, &item.Count); err != nil {
			return domain.BookmarkSidebarStatsResponse{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return domain.BookmarkSidebarStatsResponse{}, err
	}
	return domain.BookmarkSidebarStatsResponse{FolderCounts: items}, nil
}

type folderQueryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func loadPostgresFolders(ctx context.Context, queryer folderQueryer, userID string) (map[string]domain.Folder, error) {
	rows, err := queryer.Query(ctx, `select id::text, name, path, parent_id::text from folders where user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	folders := map[string]domain.Folder{}
	for rows.Next() {
		var folder domain.Folder
		if err := rows.Scan(&folder.ID, &folder.Name, &folder.Path, &folder.ParentID); err != nil {
			return nil, err
		}
		folders[folder.ID] = folder
	}
	return folders, rows.Err()
}

func sortedFolders(folders map[string]domain.Folder) []domain.Folder {
	items := make([]domain.Folder, 0, len(folders))
	for _, folder := range folders {
		items = append(items, folder)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Path < items[j].Path })
	return items
}

func taxonomyDatabaseError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return httperror.Conflict("TaxonomyAlreadyExists", "A folder or tag with the same name already exists.")
	}
	return err
}
