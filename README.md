# Schema-app

En enkel mobilvänlig app som läser in de två CSV-filerna i `raw-schema/` och visar dem som ett gemensamt schema.

## Kör appen

```bash
cd /Users/isakhaapaniemi/schema/schema
python3 -m http.server 8000
```

Öppna sedan:

```text
http://localhost:8000/
```

## Funktioner

- Slår ihop båda scheman i en lista
- Sök på kurs, typ, lärare eller plats
- Filter för kurs
- Mobilanpassad layout
