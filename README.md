# Crown Online

Profiles + order tracker. Static app in `public/`, one Python serverless function in `api/index.py`
(IMAP email reading, package tracking, encrypted storage in Upstash Redis).

Everything stored is encrypted in the browser with the user's password before it is sent here.
Built from the shared Crown sources by `build_cloud.py`.
