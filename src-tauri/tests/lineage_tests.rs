use shizumu_lib::commands::{
    fold_lineage_inner, rename_lineage_inner, set_lineage_parent_inner,
};
use shizumu_lib::test_helpers::*;
use rusqlite::{params, OptionalExtension};

#[test]
fn test_create_lineage_discrete() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let id = insert_lineage(&conn, "daily notes", "discrete");

    let (name, mode): (String, String) = conn
        .query_row(
            "SELECT name, mode FROM lineages WHERE id = ?",
            params![&id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();

    assert_eq!(name, "daily notes");
    assert_eq!(mode, "discrete");
}

#[test]
fn test_create_lineage_continuous() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let id = insert_lineage(&conn, "project alpha", "continuous");

    let mode: String = conn
        .query_row(
            "SELECT mode FROM lineages WHERE id = ?",
            params![&id],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(mode, "continuous");
}

#[test]
fn test_create_lineage_with_parent() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let parent_id = insert_lineage(&conn, "product", "discrete");

    // Create child lineage
    let child_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO lineages (id, name, created_at, mode, parent_id) VALUES (?, ?, ?, ?, ?)",
        params![&child_id, "export api", &now, "continuous", &parent_id],
    )
    .unwrap();

    let (pid, mode): (Option<String>, String) = conn
        .query_row(
            "SELECT parent_id, mode FROM lineages WHERE id = ?",
            params![&child_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();

    assert_eq!(pid, Some(parent_id));
    assert_eq!(mode, "continuous");
}

#[test]
fn test_lineage_name_unique() {
    let db = test_db();
    let conn = db.lock().unwrap();
    insert_lineage(&conn, "unique trail", "discrete");

    let result = conn.execute(
        "INSERT INTO lineages (id, name, created_at, mode) VALUES ('x', 'unique trail', '2024-01-01', 'discrete')",
        [],
    );

    assert!(result.is_err(), "Duplicate lineage name should fail");
}

#[test]
fn test_set_focus_lineage() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let lineage_id = insert_lineage(&conn, "trail", "discrete");
    let page_id = insert_page(&conn, "2024-04-06", 1);

    set_page_lineage(&conn, &page_id, &lineage_id);

    let lid: Option<String> = conn
        .query_row(
            "SELECT lineage_id FROM pages WHERE id = ?",
            params![&page_id],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(lid, Some(lineage_id));
}

#[test]
fn test_get_trail_pages_ordered() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let lineage_id = insert_lineage(&conn, "project", "continuous");

    let p1 = insert_page(&conn, "2024-04-01", 1);
    let p2 = insert_page(&conn, "2024-04-03", 1);
    let p3 = insert_page(&conn, "2024-04-05", 1);

    set_page_lineage(&conn, &p1, &lineage_id);
    set_page_lineage(&conn, &p2, &lineage_id);
    set_page_lineage(&conn, &p3, &lineage_id);

    let mut stmt = conn
        .prepare("SELECT id, date FROM pages WHERE lineage_id = ? ORDER BY date ASC, page_number ASC")
        .unwrap();
    let rows: Vec<(String, String)> = stmt
        .query_map(params![&lineage_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].1, "2024-04-01");
    assert_eq!(rows[1].1, "2024-04-03");
    assert_eq!(rows[2].1, "2024-04-05");
}

#[test]
fn test_get_trail_pages_empty() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let lineage_id = insert_lineage(&conn, "empty trail", "continuous");

    let mut stmt = conn
        .prepare("SELECT id FROM pages WHERE lineage_id = ?")
        .unwrap();
    let rows: Vec<String> = stmt
        .query_map(params![&lineage_id], |row| row.get(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    assert_eq!(rows.len(), 0);
}

#[test]
fn test_get_lineages_returns_all() {
    let db = test_db();
    let conn = db.lock().unwrap();
    insert_lineage(&conn, "trail a", "discrete");
    insert_lineage(&conn, "trail b", "continuous");
    insert_lineage(&conn, "trail c", "discrete");

    let mut stmt = conn
        .prepare("SELECT name FROM lineages ORDER BY name ASC")
        .unwrap();
    let rows: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0], "trail a");
    assert_eq!(rows[1], "trail b");
    assert_eq!(rows[2], "trail c");
}

// --- rename_lineage ---

#[test]
fn test_rename_lineage_happy() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let id = insert_lineage(&conn, "old name", "discrete");

    let updated = rename_lineage_inner(&conn, &id, "new name").expect("rename should succeed");
    assert_eq!(updated.name, "new name");

    let persisted: String = conn
        .query_row(
            "SELECT name FROM lineages WHERE id = ?",
            params![&id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(persisted, "new name");
}

#[test]
fn test_rename_lineage_trims_whitespace() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let id = insert_lineage(&conn, "old", "discrete");

    let updated = rename_lineage_inner(&conn, &id, "   spaced out   ").expect("should succeed");
    assert_eq!(updated.name, "spaced out");
}

#[test]
fn test_rename_lineage_collision() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let _existing = insert_lineage(&conn, "taken", "discrete");
    let target = insert_lineage(&conn, "fine", "discrete");

    let err = rename_lineage_inner(&conn, &target, "taken").expect_err("collision");
    assert_eq!(err, "lineage_name_taken");

    let still: String = conn
        .query_row(
            "SELECT name FROM lineages WHERE id = ?",
            params![&target],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(still, "fine");
}

#[test]
fn test_rename_lineage_empty_refused() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let id = insert_lineage(&conn, "ok", "discrete");

    let err = rename_lineage_inner(&conn, &id, "   ").expect_err("empty");
    assert_eq!(err, "lineage_name_empty");
}

#[test]
fn test_rename_lineage_missing_refused() {
    let db = test_db();
    let conn = db.lock().unwrap();

    let err = rename_lineage_inner(&conn, "nonexistent", "whatever").expect_err("missing");
    assert_eq!(err, "lineage_not_found");
}

// --- set_lineage_parent ---

#[test]
fn test_set_lineage_parent_happy() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let parent = insert_lineage(&conn, "parent", "discrete");
    let child = insert_lineage(&conn, "child", "discrete");

    let updated = set_lineage_parent_inner(&conn, &child, Some(&parent)).expect("should succeed");
    assert_eq!(updated.parent_id, Some(parent.clone()));

    let pid: Option<String> = conn
        .query_row(
            "SELECT parent_id FROM lineages WHERE id = ?",
            params![&child],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(pid, Some(parent));
}

#[test]
fn test_set_lineage_parent_to_root() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let parent = insert_lineage(&conn, "parent", "discrete");
    let child = insert_lineage_with_parent(&conn, "child", "discrete", &parent);

    let updated = set_lineage_parent_inner(&conn, &child, None).expect("lift to root");
    assert!(updated.parent_id.is_none());
}

#[test]
fn test_set_lineage_parent_self_refused() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let id = insert_lineage(&conn, "trail", "discrete");

    let err = set_lineage_parent_inner(&conn, &id, Some(&id)).expect_err("self-parent");
    assert_eq!(err, "cannot_self_parent");
}

#[test]
fn test_set_lineage_parent_direct_cycle_refused() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let a = insert_lineage(&conn, "a", "discrete");
    let b = insert_lineage_with_parent(&conn, "b", "discrete", &a);

    let err = set_lineage_parent_inner(&conn, &a, Some(&b)).expect_err("cycle");
    assert_eq!(err, "cannot_move_under_descendant");
}

#[test]
fn test_set_lineage_parent_deep_cycle_refused() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let a = insert_lineage(&conn, "a", "discrete");
    let b = insert_lineage_with_parent(&conn, "b", "discrete", &a);
    let c = insert_lineage_with_parent(&conn, "c", "discrete", &b);

    let err = set_lineage_parent_inner(&conn, &a, Some(&c)).expect_err("deep cycle");
    assert_eq!(err, "cannot_move_under_descendant");
}

#[test]
fn test_set_lineage_parent_missing_target_refused() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let id = insert_lineage(&conn, "trail", "discrete");

    let err = set_lineage_parent_inner(&conn, &id, Some("nope")).expect_err("missing parent");
    assert_eq!(err, "parent_not_found");
}

#[test]
fn test_set_lineage_parent_missing_self_refused() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let parent = insert_lineage(&conn, "parent", "discrete");

    let err = set_lineage_parent_inner(&conn, "ghost", Some(&parent)).expect_err("missing self");
    assert_eq!(err, "lineage_not_found");
}

#[test]
fn test_set_lineage_parent_descendants_come_along() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let root = insert_lineage(&conn, "root", "discrete");
    let a = insert_lineage(&conn, "a", "discrete");
    let a_child = insert_lineage_with_parent(&conn, "a-child", "discrete", &a);

    set_lineage_parent_inner(&conn, &a, Some(&root)).expect("ok");

    let a_parent: Option<String> = conn
        .query_row(
            "SELECT parent_id FROM lineages WHERE id = ?",
            params![&a],
            |row| row.get(0),
        )
        .unwrap();
    let achild_parent: Option<String> = conn
        .query_row(
            "SELECT parent_id FROM lineages WHERE id = ?",
            params![&a_child],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(a_parent, Some(root));
    assert_eq!(achild_parent, Some(a));
}

// --- fold_lineage ---

#[test]
fn test_fold_lineage_discrete_into_discrete() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let source = insert_lineage(&conn, "source", "discrete");
    let target = insert_lineage(&conn, "target", "discrete");

    let p1 = insert_page(&conn, "2026-05-01", 1);
    let p2 = insert_page(&conn, "2026-05-02", 1);
    set_page_lineage(&conn, &p1, &source);
    set_page_lineage(&conn, &p2, &source);
    let _pin1 = insert_pin(&conn, &source, &p1, "task", "do thing");
    let _pin2 = insert_pin(&conn, &source, &p2, "note", "thought");

    let result = fold_lineage_inner(&conn, &source, &target).expect("fold ok");
    assert_eq!(result.pages_moved, 2);
    assert_eq!(result.pins_moved, 2);

    let still: Option<String> = conn
        .query_row(
            "SELECT id FROM lineages WHERE id = ?",
            params![&source],
            |row| row.get(0),
        )
        .optional()
        .unwrap();
    assert!(still.is_none());

    let on_target: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pages WHERE lineage_id = ?",
            params![&target],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(on_target, 2);

    let pins_on_target: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM shared_objects WHERE lineage_id = ?",
            params![&target],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(pins_on_target, 2);
}

#[test]
fn test_fold_lineage_continuous_into_discrete() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let source = insert_lineage(&conn, "source", "continuous");
    let target = insert_lineage(&conn, "target", "discrete");

    let canonical = insert_page(&conn, "2026-05-01", 1);
    set_page_lineage(&conn, &canonical, &source);
    let _pin = insert_pin(&conn, &source, &canonical, "task", "carry forward");

    let result = fold_lineage_inner(&conn, &source, &target).expect("continuous→discrete ok");
    assert_eq!(result.pages_moved, 1);
    assert_eq!(result.pins_moved, 1);

    let on_target: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pages WHERE lineage_id = ?",
            params![&target],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(on_target, 1);
}

#[test]
fn test_fold_lineage_continuous_into_continuous_refused() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let source = insert_lineage(&conn, "source", "continuous");
    let target = insert_lineage(&conn, "target", "continuous");

    let err = fold_lineage_inner(&conn, &source, &target).expect_err("refused");
    assert_eq!(err, "cannot_fold_continuous_into_continuous");
}

#[test]
fn test_fold_lineage_discrete_into_continuous_refused() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let source = insert_lineage(&conn, "source", "discrete");
    let target = insert_lineage(&conn, "target", "continuous");

    let err = fold_lineage_inner(&conn, &source, &target).expect_err("refused");
    assert_eq!(err, "cannot_fold_discrete_into_continuous");
}

#[test]
fn test_fold_lineage_self_refused() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let id = insert_lineage(&conn, "trail", "discrete");

    let err = fold_lineage_inner(&conn, &id, &id).expect_err("refused");
    assert_eq!(err, "cannot_fold_into_self");
}

#[test]
fn test_fold_lineage_ancestor_into_descendant_refused() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let parent = insert_lineage(&conn, "parent", "discrete");
    let child = insert_lineage_with_parent(&conn, "child", "discrete", &parent);

    let err = fold_lineage_inner(&conn, &parent, &child).expect_err("refused");
    assert_eq!(err, "cannot_fold_into_descendant");
}

#[test]
fn test_fold_lineage_with_subtrails_reparents() {
    let db = test_db();
    let conn = db.lock().unwrap();
    let grandparent = insert_lineage(&conn, "grand", "discrete");
    let source = insert_lineage_with_parent(&conn, "source", "discrete", &grandparent);
    let sub1 = insert_lineage_with_parent(&conn, "sub1", "discrete", &source);
    let sub2 = insert_lineage_with_parent(&conn, "sub2", "discrete", &source);
    let target = insert_lineage(&conn, "target", "discrete");

    fold_lineage_inner(&conn, &source, &target).expect("fold ok");

    let sub1_parent: Option<String> = conn
        .query_row(
            "SELECT parent_id FROM lineages WHERE id = ?",
            params![&sub1],
            |row| row.get(0),
        )
        .unwrap();
    let sub2_parent: Option<String> = conn
        .query_row(
            "SELECT parent_id FROM lineages WHERE id = ?",
            params![&sub2],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(sub1_parent, Some(grandparent.clone()));
    assert_eq!(sub2_parent, Some(grandparent));
}

#[test]
fn test_default_mode_is_discrete() {
    let db = test_db();
    let conn = db.lock().unwrap();

    // Insert without explicit mode — should default to 'discrete'
    conn.execute(
        "INSERT INTO lineages (id, name, created_at) VALUES ('d1', 'default trail', '2024-01-01')",
        [],
    )
    .unwrap();

    let mode: String = conn
        .query_row("SELECT mode FROM lineages WHERE id = 'd1'", [], |row| {
            row.get(0)
        })
        .unwrap();

    assert_eq!(mode, "discrete");
}
