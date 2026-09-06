import os
import sqlite3
import discord
from discord.ext import commands
from image_generator import make_info, ROLE_COLORS  # 기존 image_generator.py 모듈 불러오기

# ──────────────────────────────────────────
# 봇 기본 설정
# ──────────────────────────────────────────
INTENTS = discord.Intents.default()
INTENTS.message_content = True
INTENTS.members = True

bot = commands.Bot(command_prefix="$", intents=INTENTS)

# ──────────────────────────────────────────
# SQLite DB 설정 (거래/통계/순위 관리)
# ──────────────────────────────────────────
DB_PATH = "bot_database.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            total_trade INTEGER DEFAULT 0,
            trade_count INTEGER DEFAULT 0,
            max_trade INTEGER DEFAULT 0,
            invites INTEGER DEFAULT 0
        )
    ''')
    conn.commit()
    conn.close()

init_db()

def get_user_data(user_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT total_trade, trade_count, max_trade, invites FROM users WHERE user_id = ?", (str(user_id),))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return {
            "total_trade": row[0],
            "trade_count": row[1],
            "max_trade": row[2],
            "invites": row[3]
        }
    return {"total_trade": 0, "trade_count": 0, "max_trade": 0, "invites": 0}

def get_user_rank(user_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT user_id, RANK() OVER (ORDER BY total_trade DESC) as rank
        FROM users
    """)
    rows = cursor.fetchall()
    conn.close()
    
    for uid, rank in rows:
        if uid == str(user_id):
            return f"#{rank}"
    return "#1"

def update_user_trade(user_id, amount):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    data = get_user_data(user_id)
    new_total = data["total_trade"] + amount
    new_count = data["trade_count"] + 1
    new_max = max(data["max_trade"], amount)
    
    cursor.execute('''
        INSERT INTO users (user_id, total_trade, trade_count, max_trade)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            total_trade = ?,
            trade_count = ?,
            max_trade = ?
    ''', (str(user_id), new_total, new_count, new_max, new_total, new_count, new_max))
    
    conn.commit()
    conn.close()

# ──────────────────────────────────────────
# 디스코드 이벤트 & 명령어
# ──────────────────────────────────────────

@bot.event
async def on_ready():
    print(f"Logged in as {bot.user.name} (ID: {bot.user.id})")

# [$정보 명령어]
@bot.command(name="정보")
async def info_command(ctx, member: discord.Member = None):
    target = member or ctx.author
    
    # 1. 디스코드 프로필 이미지 다운로드
    avatar_filename = f"avatar_{target.id}.png"
    await target.display_avatar.save(avatar_filename)
    
    # 2. 역할 파악
    target_role = "회원"
    for r in target.roles:
        if r.name in ROLE_COLORS:
            target_role = r.name
            break

    # 3. DB 통계 데이터 조회
    user_data = get_user_data(target.id)
    rank = get_user_rank(target.id)
    
    # 4. 이미지 생성
    joined_date = target.joined_at.strftime("%Y. %m. %d") if target.joined_at else "2026. 03. 18"
    
    img = make_info(
        username=target.name,
        discriminator=f"#{target.discriminator}" if target.discriminator != "0" else "#0001",
        joined=joined_date,
        role=target_role,
        total_trade=f"₩{user_data['total_trade']:,}",
        trade_count=str(user_data["trade_count"]),
        max_trade=f"₩{user_data['max_trade']:,}",
        invites=str(user_data["invites"]),
        rank=rank,
        avatar=avatar_filename
    )
    
    # 5. 임시 이미지 저장 후 전송
    output_filename = f"profile_{target.id}.png"
    img.save(output_filename)
    
    await ctx.send(file=discord.File(output_filename))
    
    # 임시 파일 정리
    if os.path.exists(avatar_filename):
        os.remove(avatar_filename)
    if os.path.exists(output_filename):
        os.remove(output_filename)

# [$지급완료 명령어] 관리자용: 구매 시 역할 지급 + 금액 DB 반영
@bot.command(name="지급완료")
@commands.has_permissions(administrator=True)
async def grant_trade(ctx, member: discord.Member, amount: int, role_name: str = None):
    # 1. DB 거래 금액 및 횟수 기록
    update_user_trade(member.id, amount)
    
    # 2. 역할 부여 (역할명이 지정된 경우)
    assigned_role_msg = ""
    if role_name:
        role = discord.utils.get(ctx.guild.roles, name=role_name)
        if role:
            await member.add_roles(role)
            assigned_role_msg = f" 및 **{role.name}** 역할 부여 완료"
        else:
            assigned_role_msg = f" (주의: '{role_name}' 역할을 찾을 수 없음)"

    await ctx.send(f"✅ {member.mention}님에게 **₩{amount:,}원** 거래 기록 완료{assigned_role_msg}!")

# ──────────────────────────────────────────
# 봇 실행
# ──────────────────────────────────────────
TOKEN = "여기에_디스코드_봇_토큰을_넣으세요"
bot.run(TOKEN)
