#!/usr/bin/env python3
import argparse
import concurrent.futures
import json
import re
import subprocess
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path


USER_ID = "2afc9cc7-c0ce-4e5c-95a7-2a15dbd60f3d"
API_BASE = "http://127.0.0.1:8000"
CONFIG_PATH = Path("/opt/grok2api/config.yaml")
POSTGRES_CONTAINER = "keeppage-postgres"


def psql(sql: str) -> str:
    result = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            POSTGRES_CONTAINER,
            "psql",
            "-U",
            "keeppage",
            "-d",
            "keeppage",
            "-X",
            "-At",
            "-v",
            "ON_ERROR_STOP=1",
        ],
        input=sql,
        text=True,
        capture_output=True,
        check=True,
    )
    return result.stdout


def query_json(sql: str) -> list[dict]:
    output = psql(sql)
    return [json.loads(line) for line in output.splitlines() if line.strip()]


def load_catalog() -> tuple[list[dict], list[str], list[str]]:
    bookmarks = query_json(
        f"""
SELECT json_build_object(
  'id', b.id,
  'title', coalesce(nullif(trim(b.title), ''), '无标题'),
  'site', coalesce(b.domain, ''),
  'updatedAt', b.updated_at,
  'currentFolder', f.path,
  'currentTags', coalesce((
    SELECT json_agg(t.name ORDER BY t.name)
    FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id
    WHERE bt.bookmark_id = b.id
  ), '[]'::json)
)::text
FROM bookmarks b
LEFT JOIN folders f ON f.id = b.folder_id
WHERE b.user_id = '{USER_ID}'
ORDER BY b.created_at, b.id;
"""
    )
    folders = [
        row["path"]
        for row in query_json(
            f"SELECT json_build_object('path', path)::text FROM folders WHERE user_id = '{USER_ID}' ORDER BY path;"
        )
    ]
    tags = [
        row["name"]
        for row in query_json(
            f"SELECT json_build_object('name', name)::text FROM tags WHERE user_id = '{USER_ID}' ORDER BY name;"
        )
    ]
    return bookmarks, folders, tags


def yaml_value(section: str, key: str) -> str:
    in_section = False
    for line in CONFIG_PATH.read_text(encoding="utf-8").splitlines():
        if line and not line.startswith((" ", "#")):
            in_section = line.rstrip() == f"{section}:"
            continue
        if in_section:
            match = re.match(rf"^  {re.escape(key)}:\s*(.*?)\s*$", line)
            if match:
                return match.group(1).strip().strip('"')
    raise RuntimeError(f"missing {section}.{key}")


def request_json(path: str, *, method: str = "GET", token: str = "", body=None, timeout=180):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(API_BASE + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def get_client_secret() -> str:
    login = request_json(
        "/api/admin/v1/auth/login",
        method="POST",
        body={
            "username": yaml_value("bootstrapAdmin", "username"),
            "password": yaml_value("bootstrapAdmin", "password"),
        },
    )
    access = login["data"]["tokens"]["accessToken"]
    secret = request_json("/api/admin/v1/client-keys/1/secret", token=access)
    return secret["data"]["secret"]


def parse_model_json(content: str) -> dict:
    content = content.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)\s*```", content, re.S)
    if fenced:
        content = fenced.group(1)
    start = content.find("{")
    end = content.rfind("}")
    if start < 0 or end < start:
        raise ValueError("model response does not contain a JSON object")
    return json.loads(content[start : end + 1])


def classify_batch(batch: list[dict], folders: list[str], tags: list[str], secret: str) -> list[dict]:
    prompt = f"""你是书签分类器。根据每条书签的标题语义进行分类，网站域名只用于标题过于笼统时辅助判断。

规则：
1. 每条书签必须且只能选择一个收藏夹，必须逐字来自候选收藏夹。
2. 每条可选择 0-3 个标签，必须逐字来自候选标签；只有确实相关才加，不要为了凑数添加。
3. 标题语义优先。Go/Golang 放 go；MySQL 放 Mysql；算法题和数据结构放 算法；AI 模型/API 放 AI/大模型；AI Agent/Claude Code/Codex/Skill 按语义放 AI Agent、Skill、AI提效或 AI；代理机场放 机场；自托管服务面板放 自建或 自建网站；软件工具放 工具、编程工具或 Mac软件；逆向/破解/安全研究区分 逆向、破解应用、破甲。
4. 不要因为来源是 GitHub 就一律放 Github，按项目实际主题分类。
5. 信息不足时优先放 收集箱，不要虚构候选项。
6. 必须覆盖输入中的每个 id，且只输出 JSON，不要解释。

候选收藏夹：{json.dumps(folders, ensure_ascii=False)}
候选标签：{json.dumps(tags, ensure_ascii=False)}

输入：{json.dumps([{'id': item['id'], 'title': item['title'], 'site': item['site']} for item in batch], ensure_ascii=False)}

输出格式：{{"assignments":[{{"id":"...","folder":"候选收藏夹","tags":["候选标签"]}}]}}"""
    expected_ids = {item["id"] for item in batch}
    allowed_folders = set(folders)
    allowed_tags = set(tags)
    last_error = None
    for attempt in range(3):
        try:
            response = request_json(
                "/v1/chat/completions",
                method="POST",
                token=secret,
                timeout=300,
                body={
                    "model": "grok-4.6",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.1,
                    "stream": False,
                },
            )
            parsed = parse_model_json(response["choices"][0]["message"]["content"])
            assignments = parsed["assignments"]
            actual_ids = {item["id"] for item in assignments}
            if actual_ids != expected_ids or len(assignments) != len(batch):
                raise ValueError(f"id coverage mismatch: expected {len(batch)}, got {len(actual_ids)}")
            for item in assignments:
                if item["folder"] not in allowed_folders:
                    raise ValueError(f"unknown folder: {item['folder']}")
                item["tags"] = list(dict.fromkeys(item.get("tags") or []))
                if len(item["tags"]) > 3 or not set(item["tags"]).issubset(allowed_tags):
                    raise ValueError(f"invalid tags for {item['id']}: {item['tags']}")
            return assignments
        except (KeyError, TypeError, ValueError, json.JSONDecodeError, urllib.error.URLError) as error:
            last_error = error
            time.sleep(2**attempt)
    raise RuntimeError(f"batch failed after retries: {last_error}")


def generate_plan(output_path: Path) -> None:
    bookmarks, folders, tags = load_catalog()
    if not bookmarks or not folders or not tags:
        raise RuntimeError("bookmark or taxonomy catalog is empty")
    secret = get_client_secret()
    batches = [bookmarks[index : index + 40] for index in range(0, len(bookmarks), 40)]
    assignments_by_id = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(classify_batch, batch, folders, tags, secret) for batch in batches]
        for index, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            for assignment in future.result():
                assignments_by_id[assignment["id"]] = assignment
            print(f"classified batch {index}/{len(batches)}", flush=True)
    if set(assignments_by_id) != {item["id"] for item in bookmarks}:
        raise RuntimeError("final assignment coverage mismatch")
    plan = []
    for bookmark in bookmarks:
        assignment = assignments_by_id[bookmark["id"]]
        target_tags = sorted(assignment["tags"])
        current_tags = sorted(bookmark["currentTags"])
        plan.append(
            {
                "bookmarkId": bookmark["id"],
                "title": bookmark["title"],
                "site": bookmark["site"],
                "expectedUpdatedAt": bookmark["updatedAt"],
                "currentFolder": bookmark["currentFolder"],
                "currentTags": current_tags,
                "folder": assignment["folder"],
                "tags": target_tags,
                "changed": bookmark["currentFolder"] != assignment["folder"] or current_tags != target_tags,
            }
        )
    output_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print_summary(plan, output_path)


def print_summary(plan: list[dict], path: Path) -> None:
    folder_counts = Counter(item["folder"] for item in plan)
    tag_counts = Counter(tag for item in plan for tag in item["tags"])
    print(f"plan={path} total={len(plan)} changed={sum(item['changed'] for item in plan)}")
    print("folders=" + json.dumps(folder_counts.most_common(), ensure_ascii=False))
    print("tags=" + json.dumps(tag_counts.most_common(), ensure_ascii=False))
    print(f"without_tags={sum(not item['tags'] for item in plan)}")


def apply_plan(plan_path: Path) -> None:
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    if len(plan) != 643 or len({item["bookmarkId"] for item in plan}) != len(plan):
        raise RuntimeError("refusing to apply an incomplete or duplicate plan")
    payload = [
        {
            "bookmark_id": item["bookmarkId"],
            "expected_updated_at": item["expectedUpdatedAt"],
            "folder_path": item["folder"],
            "tag_names": item["tags"],
        }
        for item in plan
    ]
    payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    sql = f"""
BEGIN;
CREATE TEMP TABLE organize_plan AS
SELECT bookmark_id::uuid, expected_updated_at::timestamptz, folder_path, tag_names
FROM jsonb_to_recordset($plan${payload_json}$plan$::jsonb)
AS x(bookmark_id text, expected_updated_at text, folder_path text, tag_names jsonb);

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM organize_plan;
  IF n <> 643 THEN RAISE EXCEPTION 'plan count mismatch: %', n; END IF;
  SELECT count(*) INTO n
  FROM organize_plan p
  LEFT JOIN bookmarks b ON b.id = p.bookmark_id AND b.user_id = '{USER_ID}'
  WHERE b.id IS NULL OR b.updated_at <> p.expected_updated_at;
  IF n <> 0 THEN RAISE EXCEPTION 'bookmark conflict count: %', n; END IF;
  SELECT count(*) INTO n
  FROM organize_plan p LEFT JOIN folders f ON f.user_id = '{USER_ID}' AND f.path = p.folder_path
  WHERE f.id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'missing folder count: %', n; END IF;
  SELECT count(*) INTO n
  FROM organize_plan p
  CROSS JOIN LATERAL jsonb_array_elements_text(p.tag_names) AS j(tag_name)
  LEFT JOIN tags t ON t.user_id = '{USER_ID}' AND t.name = j.tag_name
  WHERE t.id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'missing tag count: %', n; END IF;
END $$;

CREATE TEMP TABLE changed_bookmarks AS
SELECT b.id
FROM bookmarks b
JOIN organize_plan p ON p.bookmark_id = b.id
JOIN folders f ON f.user_id = b.user_id AND f.path = p.folder_path
WHERE b.folder_id IS DISTINCT FROM f.id
   OR coalesce((SELECT jsonb_agg(t.name ORDER BY t.name) FROM bookmark_tags bt JOIN tags t ON t.id=bt.tag_id WHERE bt.bookmark_id=b.id), '[]'::jsonb)
      <> (SELECT coalesce(jsonb_agg(value ORDER BY value), '[]'::jsonb) FROM jsonb_array_elements_text(p.tag_names));

UPDATE bookmarks b
SET folder_id = f.id, updated_at = now()
FROM organize_plan p
JOIN folders f ON f.user_id = '{USER_ID}' AND f.path = p.folder_path
JOIN changed_bookmarks c ON c.id = p.bookmark_id
WHERE b.id = p.bookmark_id;

DELETE FROM bookmark_tags bt USING changed_bookmarks c WHERE bt.bookmark_id = c.id;
INSERT INTO bookmark_tags(bookmark_id, tag_id)
SELECT p.bookmark_id, t.id
FROM organize_plan p
JOIN changed_bookmarks c ON c.id = p.bookmark_id
CROSS JOIN LATERAL jsonb_array_elements_text(p.tag_names) AS j(tag_name)
JOIN tags t ON t.user_id = '{USER_ID}' AND t.name = j.tag_name;

SELECT 'changed=' || count(*) FROM changed_bookmarks;
COMMIT;
"""
    print(psql(sql).strip())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument("--apply", type=Path)
    parser.add_argument("--summary", type=Path)
    args = parser.parse_args()
    if args.apply:
        apply_plan(args.apply)
    elif args.summary:
        print_summary(json.loads(args.summary.read_text(encoding="utf-8")), args.summary)
    elif args.output:
        generate_plan(args.output)
    else:
        parser.error("one of --output, --apply, or --summary is required")


if __name__ == "__main__":
    main()
