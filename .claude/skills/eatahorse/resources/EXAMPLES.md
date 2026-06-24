# Eatahorse examples

## Start a new board

```bash
python scripts/eatahorse.py init "API Hardening" --goal "Reduce auth and input-validation risk before launch"
```

## Add a security task

```bash
python scripts/eatahorse.py add "Add fail-closed auth middleware" \
  --status ready \
  --priority P1 \
  --tag security \
  --bite "Trace current unauthenticated request path" \
  --bite "Add middleware skeleton" \
  --bite "Add negative-path tests" \
  --accept "Unauthenticated protected routes return 401" \
  --accept "Existing public routes still work"
```

## Work one bite

```bash
python scripts/eatahorse.py move EH-0001 doing
python scripts/eatahorse.py bite EH-0001 1 --done
python scripts/eatahorse.py next
```

## Add a bite after discovering more work

```bash
python scripts/eatahorse.py add-bite EH-0001 "Add regression test for missing bearer prefix"
```

## Sync after editing markdown manually

```bash
python scripts/eatahorse.py sync
```

## Drop a task without losing history

```bash
python scripts/eatahorse.py remove EH-0001
```

## Purge a task entirely

```bash
python scripts/eatahorse.py remove EH-0001 --purge
```

## Read board status

```bash
python scripts/eatahorse.py report
python scripts/eatahorse.py list --status doing
cat .eatahorse/board.md
```
