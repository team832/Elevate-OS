# Bringing the old task tracker into Elevate

For the owner and operations managers. Takes about five minutes per person once you have their file.

## Before you start

- The old tracker keeps each person's tasks **inside their own browser**. The tracker file (`Task Tracker.html`) has no records in it, so Elevate cannot read anything from it. You need a **backup file from each person**.
- You need the operations manager sign-in (only that role can import).
- Nothing is sent to anyone during an import: no messages, no notifications.

## Step 1 — each person exports their backup

Ask each person to do this on the computer and browser they use the tracker in:

1. Open `Task Tracker.html` in the browser, as usual.
2. Click **Backup** (top right, next to their name).
3. Click **Export backup**.
4. The browser downloads a file named like `Task-EOD-backup-2026-10-21.json`.
5. Send that file to you (email, pen drive, or shared folder). One file per person.

If someone uses two computers, they export from each; import each file separately for the same person.

## Step 2 — preview the file in Elevate

1. Sign in to Elevate and open **Business Operations → Tasks → Imports** (`/ops/tasks/imports`).
2. Under **Upload a backup file**, click **Choose file** and pick the person's `.json` file.
3. Elevate shows the name, email and employee ID written in the file, and how many tasks and reports it holds.
   - If you picked the tracker program instead, it says "This is the tracker program, not a data export". Go back to step 1.
4. In **Whose tracker file is this?**, choose the person.
   - Elevate pre-selects someone only when the file's email or employee ID matches a staff record exactly. It never guesses from the name. Check the choice.
5. Click **Preview import**. Nothing is imported yet.

## Step 3 — read the preview

Each record gets one outcome:

| Outcome | Meaning | What to do |
|---|---|---|
| Accepted | Will be imported | Nothing |
| Already imported | Same record came in before | Nothing |
| Changed since last import | Edited in the tracker after an earlier import | Elevate keeps its own version. Update the task in Elevate if the tracker is right |
| Skipped | An Elevate end-of-day report already exists for that day | Nothing; Elevate's report is kept |
| Needs a person | Missing something Elevate needs (usually a deadline) | Ask the person to fix it in the tracker, export again, upload again |
| Unreadable | The record is damaged | Tell us; the original stays in the stored copy |

Note on dates: the old tracker used the UTC clock, so anything it stamped between midnight and 5:29 am shows the previous day. Elevate keeps the dates exactly as the file has them.

## Step 4 — import

1. If the preview looks right, click **Import N records for <name>** at the top of the preview.
2. Elevate imports everything accepted in one go. If anything fails, nothing is imported.
3. The page then shows what happened to every record. This stays under **Import history**.

Imported tasks show source "import". The old tracker kept no history, so each imported task has one "imported" entry dated the day you import it; its original dates (created, completed, deadline) are kept on the task and in that entry. Imported tasks therefore do not appear in end-of-day or period reports for days before the import. Imported end-of-day reports are kept as history: they are marked as imported from the old tracker and were never sent through Elevate.

## Doing it again

- Uploading the same file again imports nothing: every record that came in shows "Already imported"; records that needed a person or were unreadable keep those outcomes until the person fixes them and exports again.
- A newer backup from the same person adds only new records and lists changed ones.

## Ask for help when

- A person's file is refused and they did export it from **Backup → Export backup**.
- You imported a file for the wrong person. There is no one-click undo; we remove it with a reviewed database change after a backup.
