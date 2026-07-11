package migrations

import "testing"

func TestValidateUniquePrefixes(t *testing.T) {
	if err := validateUniquePrefixes([]string{"0001_a.sql", "0002_b.sql"}); err != nil {
		t.Fatal(err)
	}
	if err := validateUniquePrefixes([]string{"0004_a.sql", "0004_b.sql"}); err == nil {
		t.Fatal("expected duplicate prefix to fail")
	}
}

func TestListMigrationFilesAreUnique(t *testing.T) {
	names, err := listMigrationFiles()
	if err != nil {
		t.Fatal(err)
	}
	if len(names) == 0 {
		t.Fatal("expected embedded migrations")
	}
	if err := validateUniquePrefixes(names); err != nil {
		t.Fatal(err)
	}
}
