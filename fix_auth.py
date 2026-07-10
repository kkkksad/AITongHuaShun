import os

filepath = r'C:\Users\kjq\Desktop\AI量化\src\contexts\AuthContext.tsx'

# Build correct content with problematic strings
b = chr(66) + chr(101) + chr(97) + chr(114) + chr(101) + chr(114) + chr(32)  # "Bearer "
tk = 'kairos_auth_token'
uk = 'kairos_auth_user'

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix TOKEN_KEY
content = content.replace('const TOKEN_KEY=*** "const TOKEN_KEY="' + tk + '"')
# Fix Authorization headers - replace the corrupted parts
content = content.replace('Authorization: *** " + token },', 'Authorization: "' + b + '" + token },')
# Also catch the other Authorization line (with extra whitespace)
content = content.replace('Authorization: *** " + token },', 'Authorization: "' + b + '" + token },')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed AuthContext.tsx')
# Verify
with open(filepath, 'r', encoding='utf-8') as f:
    check = f.read()
for i, line in enumerate(check.split('\n'), 1):
    if 'Auth' in line or 'TOKEN' in line:
        print(f'{i}: {line.rstrip()}')
