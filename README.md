# iw-cron

Cron Jobs for iw

## Usage

Create records in `/cron`. Record name can be anything. Record content must either have a "cron" property which uses crontab-style syntax to schedule recurring tasks. Alternatively the "on" property can be used to schedule a one-time event by specifying a date string in format "YYYY-MM-DD hh:mm:ss.SSS".

The following actions can be triggered:
- `setRecord`: replaces the contents of an entire record with the provided data
- `updateRecord`: merges the contents of a record with the provided data
- `deleteRecord`: deletes a record
- `call`: makes an RPC call
- `emit`: emits an event

Example cron record with all properties:

```jsonc
{
  "cron": "* * * * * *", // seconds minutes hours days months years
  "on": "2013-02-08 09:30:26.123", // you must use either "cron" OR "on"
  "setRecord": { "name": "foo/bar", "data": {} },
  "updateRecord": { "name": "foo/bar", "data": {} },
  "deleteRecord": "foo/bar",
  "call": { "name": "foo/bar", "data": {} },
  "emit": { "name": "foo/bar", "data": {} },
}
```