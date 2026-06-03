import shutil
import os

next_dir = "/vercel/share/v0-project/.next"
if os.path.exists(next_dir):
    shutil.rmtree(next_dir)
    print(f"Deleted {next_dir}")
else:
    print(f"{next_dir} does not exist, nothing to delete")

# Also verify mongodb.ts content
mongodb_ts = "/vercel/share/v0-project/lib/mongodb.ts"
with open(mongodb_ts, "r") as f:
    content = f.read()
print(f"\n--- lib/mongodb.ts content ---\n{content}")

# Verify info/route.ts content
info_route = "/vercel/share/v0-project/app/api/affiliate/info/route.ts"
with open(info_route, "r") as f:
    content = f.read()
print(f"\n--- info/route.ts first 5 lines ---")
for line in content.split("\n")[:5]:
    print(line)
