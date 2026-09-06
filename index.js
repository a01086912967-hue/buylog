import discord
from discord import app_commands
import os
from dotenv import load_dotenv
from PIL import Image, ImageDraw, ImageFont
import io
import aiohttp
import sqlite3 # SQLite 데이터베이스 모듈 추가
from datetime import datetime

# .env 파일 로드
load_dotenv()
TOKEN = os.getenv('DISCORD_TOKEN')

# 디스코드 설정
intents = discord.Intents.default()
intents.members = True
intents.message_content = True
client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)

# --- [ 설정 구역 ] ---
GUILD_ID = '1456729030459134115'
PURCHASE_LOG_CHANNEL_ID = '1457384858065047663'

# 파일 기반 데이터베이스 경로
DB_PATH = 'database.db'

# 폰트 설정 (맑은 고딕 사용 - 윈도우 기준, 리눅스/맥은 경로 수정 필요)
# 산돌 구름 같은 외부 폰트 설치 필요 없이 시스템 기본 폰트 사용
font_path = "C:/Windows/Fonts/malgun.ttf" # 윈도우
# 리눅스 예시: "/usr/share/fonts/truetype/nanum/NanumGothic.ttf"
# 맥 예시: "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"

# 서버 역할 ID 및 이름 (높은 순서대로)
SERVER_ROLES_CONFIG = [
    ('1456729030459134117', '방장 👑'),
    ('1458178323434836199', '서버 관리자 👑'),
    ('1545686320993796126', '서버 관리자 👑'),
    ('1529484356748574720', '판매자 💎'),
    ('1522815168286036098', '판매자 💎'),
    ('1456735270119411734', '회원 👤')
]

# 구매 등급 ID 및 이름 (높은 순서대로)
BUY_TIERS_CONFIG = [
    ('1489943721146449920', 'Crystal 💎'),
    ('1456737896525725719', 'Emerald 🟢'),
    ('1456736865779581031', 'Ruby 🔴'),
    ('1456736771344826535', 'Gold 🟡'),
    ('1456736573797171384', 'Silver ⚪'),
    ('1457383788236505299', 'Bronze 🟤')
]

# --- [ 데이터베이스 관련 함수 ] ---
def init_db():
    """데이터베이스 파일 및 테이블 초기화"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 유저 데이터 테이블 생성 (있으면 건너뜀)
    # user_id: 디스코드 유저 ID (기본키)
    # total_amount: 총 구매 금액
    # buy_count: 총 구매 횟수
    # max_amount: 단일 최대 거래 금액
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            total_amount INTEGER DEFAULT 0,
            buy_count INTEGER DEFAULT 0,
            max_amount INTEGER DEFAULT 0
        )
    ''')
    conn.commit()
    conn.close()
    print("✅ 데이터베이스 초기화 완료.")

def update_user_purchase(user_id, amount):
    """유저 구매 데이터 업데이트 (DB에 저장)"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 1. 유저 데이터가 존재하는지 확인
    cursor.execute('SELECT total_amount, buy_count, max_amount FROM users WHERE user_id = ?', (str(user_id),))
    result = cursor.fetchone()
    
    if result:
        # 데이터가 있으면 업데이트
        current_total, current_count, current_max = result
        new_total = current_total + amount
        new_count = current_count + 1
        new_max = max(current_max, amount)
        
        cursor.execute('''
            UPDATE users 
            SET total_amount = ?, buy_count = ?, max_amount = ? 
            WHERE user_id = ?
        ''', (new_total, new_count, new_max, str(user_id)))
    else:
        # 데이터가 없으면 새로 삽입
        cursor.execute('''
            INSERT INTO users (user_id, total_amount, buy_count, max_amount) 
            VALUES (?, ?, ?, ?)
        ''', (str(user_id), amount, 1, amount))
        
    conn.commit()
    conn.close()
    print(f"💾 DB 저장: {user_id} - 금액 {amount} 추가 완료.")

def get_user_data(user_id):
    """특정 유저의 DB 데이터 가져오기"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT total_amount, buy_count, max_amount FROM users WHERE user_id = ?', (str(user_id),))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return {
            'total_amount': result[0],
            'buy_count': result[1],
            'max_amount': result[2]
        }
    else:
        # DB에 데이터가 없는 신규 유저
        return {'total_amount': 0, 'buy_count': 0, 'max_amount': 0}

def get_user_rank(user_id):
    """총 구매 금액 기준 유저의 순위 가져오기"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    # 총 구매 금액 내림차순 정렬
    cursor.execute('SELECT user_id FROM users ORDER BY total_amount DESC')
    results = cursor.fetchall()
    conn.close()
    
    for i, (uid,) in enumerate(results):
        if uid == str(user_id):
            return f"#{i + 1}"
    
    # 데이터가 없으면 일단 최하위 순위 표시
    return f"#{len(results) + 1}"

# --- [ 유틸리티 함수 ] ---
async def fetch_avatar(url):
    """유저 아바타 이미지를 가져옴"""
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            if response.status == 200:
                return await response.read()
            return None

def get_highest_role_name(member, config_list):
    """멤버가 가진 가장 높은 우선순위의 역할 이름을 가져옴"""
    if not member or not member.roles:
        return "회원 👤" # 멤버 정보가 없거나 역할이 없으면 기본값
        
    for role_id, role_name in config_list:
        if any(role.id == int(role_id) for role in member.roles):
            return role_name
    return "회원 👤" # 설정된 역할이 없으면 기본값

def get_highest_tier_name(member, config_list):
    """멤버가 가진 가장 높은 우선순위의 등급 이름을 가져옴"""
    if not member or not member.roles:
        return "NONE" # 멤버 정보가 없거나 역할이 없으면 기본값
        
    for role_id, role_name in config_list:
        if any(role.id == int(role_id) for role in member.roles):
            return role_name
    return "NONE" # 설정된 역할이 없으면 기본값


# --- [ 디스코드 이벤트 및 명령어 ] ---
@client.event
async def on_ready():
    # 봇 실행 시 데이터베이스 초기화
    init_db()
    
    await tree.sync(guild=discord.Object(id=GUILD_ID))
    print(f'✅ {client.user.name} 봇 준비 완료 및 명령어 동기화 완료!')
    print(f'   데이터베이스 파일: {DB_PATH}')


@tree.command(name="지급완료", description="구매 데이터를 기록하고 로그를 전송합니다.", guild=discord.Object(id=GUILD_ID))
@app_commands.describe(구매자="아이템을 지급받을 유저", 금액="거래 금액 (숫자만 입력)")
async def complete_payment(interaction: discord.Interaction, 구매자: discord.Member, 금액: int):
    # 1. 권한 체크 (예: 관리자만 사용 가능하게 하거나 특정 역할만 사용 가능하게 설정 가능)
    if not interaction.user.guild_permissions.administrator:
        await interaction.response.send_message("❌ 이 명령어를 사용할 권한이 없습니다.", ephemeral=True)
        return

    # 2. 데이터베이스에 구매 데이터 업데이트 (영구 저장)
    update_user_purchase(구매자.id, 금액)
    
    # 3. 구매 완료 응답 (봇이 명령어를 실행한 채널)
    # 이미지 레이아웃 참고: '아이템이 정상적으로 지급되었어요.' 메시지
    success_embed = discord.Embed(
        description=f"**{구매자.mention}님, 아이템이 정상적으로 지급되었어요.** <a:veryheart:1479957265871143104>", 
        color=0xFFC1D6 # 다크 핑크 테마
    )
    # 실제 리뷰 채널 링크로 수정 필요
    success_embed.add_field(name="", value="https://discord.com/channels/1456729030459134115/1457384179535712473 작성을 필수입니다")
    await interaction.response.send_message(embed=success_embed)

    # 4. 구매 로그 채널로 로그 전송
    log_channel = client.get_channel(int(PURCHASE_LOG_CHANNEL_ID))
    if log_channel:
        # 다크 핑크 테마로 로그 Embed 구성
        log_embed = discord.Embed(title="🛍️ 아이템 지급 완료 로그", color=0xFFC1D6, timestamp=datetime.now())
        log_embed.add_field(name="구매자", value=f"{구매자.mention} ({구매자.id})", inline=True)
        log_embed.add_field(name="처리 관리자", value=f"{interaction.user.mention}", inline=True)
        log_embed.add_field(name="거래 금액", value=f"₩{금액:,}", inline=False) # 쉼표 표시
        
        # 유저의 최신 누적 데이터 DB에서 가져오기
        user_data = get_user_data(구매자.id)
        log_embed.add_field(name="유저 누적 금액", value=f"₩{user_data['total_amount']:,}", inline=True)
        log_embed.add_field(name="유저 누적 횟수", value=f"{user_data['buy_count']}회", inline=True)
        
        await log_channel.send(embed=log_embed)
    else:
        print(f"❌ 로그 채널 (ID: {PURCHASE_LOG_CHANNEL_ID})을 찾을 수 없습니다.")


@client.event
async def on_message(message):
    if message.author.bot or not message.content.startswith('$'):
        return

    command = message.content[1:].strip().split(' ')
    cmd_name = command[0]
    
    # --- [ $정보 명령 : 보낸 이미지 스타일 커스텀 ] ---
    if cmd_name == '정보':
        await message.channel.typing()
        
        # 대상을 가져옴 (멘션된 유저 또는 명령어 보낸 유저)
        target = message.author
        if len(command) > 1 and len(message.mentions) > 0:
            target = message.mentions[0]
            
        # 1. 데이터베이스에서 유저 구매 데이터 가져오기 (로드)
        user_data = get_user_data(target.id)
        
        # 2. 이미지 생성 시작 (다크 핑크 테마)
        W, H = 900, 480
        # 배경 (레이아웃 참고: 아주 짙은 다크그레이)
        bg_color = "#121114"
        image = Image.new("RGB", (W, H), bg_color)
        draw = ImageDraw.Draw(image)

        # 폰트 로드
        try:
            font_title = ImageFont.truetype(font_path, 32)
            font_id = ImageFont.truetype(font_path, 16)
            font_role = ImageFont.truetype(font_path, 18)
            font_card_title = ImageFont.truetype(font_path, 15)
            font_card_value = ImageFont.truetype(font_path, 32) # 거래횟수, 순위용
            font_card_money = ImageFont.truetype(font_path, 22) # 총거래량용
            font_card_tier = ImageFont.truetype(font_path, 20) # 구매등급용
            font_card_sub = ImageFont.truetype(font_path, 12) # 최대거래금액용
            font_footer = ImageFont.truetype(font_path, 12)
        except Exception as e:
            print(f"❌ 폰트 로드 실패: {e}")
            return

        # --- 상단 프로필 구역 ---
        # 아바타 가져오기 및 그리기
        avatar_data = await fetch_avatar(target.display_avatar.url)
        if avatar_data:
            avatar_img = Image.open(io.BytesIO(avatar_data)).convert("RGBA")
            avatar_img = avatar_img.resize((110, 110))
            
            # 둥글게 자르기
            mask = Image.new("L", (110, 110), 0)
            mask_draw = ImageDraw.Draw(mask)
            mask_draw.ellipse((0, 0, 110, 110), fill=255)
            
            # 아바타 그리기
            image.paste(avatar_img, (60, 60), mask)
            
            # 아바타 다크 핑크 테두리
            border_color = "#FFC1D6"
            draw.ellipse((58, 58, 172, 172), outline=border_color, width=3)

        # 닉네임 및 디스코드 ID 그리기
        draw.text((195, 75), target.name, font=font_title, fill="white")
        draw.text((195, 112), f"@{target.name}", font=font_id, fill="#8B858F")

        # 유저의 가장 높은 서버 역할 그리기
        highest_server_role = get_highest_role_name(target, SERVER_ROLES_CONFIG)
        draw.text((195, 143), highest_server_role, font=font_role, fill="#FFC1D6")

        # 상단 우측 가입일 및 서버 정보 구역 (디자인 레이아웃 참고)
        joined_str = target.guild_choices.strftime("%Y. %m. %d")
        draw.text((520, 85), "가입일", font=font_id, fill="#8B858F")
        draw.text((520, 105), joined_str, font=font_role, fill="white")
        
        # 구분선
        draw.line((670, 75, 670, 125), fill="#28242A", width=1)
        
        draw.text((700, 85), "서버", font=font_id, fill="#8B858F")
        draw.text((700, 105), f"{target.guild.name[:15]}...", font=font_role, fill="white")

        # --- 메인 데이터 카드 4개 구역 ---
        card_y = 200
        card_h = 190
        card_w = 195
        gap = 15
        
        card_bg = "#1B191E" # 카드 배경색 (디자인 참고: 배경보다 살짝 밝은색)

        # 1. 총 거래량 카드 (최대 거래 금액 포함)
        draw.rounded_rectangle([40, card_y, 40 + card_w, card_y + card_h], radius=16, fill=card_bg)
        draw.text((60, card_y + 40), "총 거래량", font=font_card_title, fill="#8B858F")
        # DB에서 가져온 금액에 천단위 쉼표 표시
        total_amount_str = f"₩{user_data['total_amount']:,}"
        draw.text((60, card_y + 85), total_amount_str, font=font_card_money, fill="white")
        
        draw.text((60, card_y + 130), "최대 거래 금액", font=font_card_sub, fill="#8B858F")
        # DB에서 가져온 최대 금액 표시
        max_amount_str = f"₩{user_data['max_amount']:,}"
        draw.text((60, card_y + 150), max_amount_str, font=font_card_money, fill="#DDDDDD")


        # 2. 총 거래 횟수 카드
        x_2 = 40 + card_w + gap
        draw.rounded_rectangle([x_2, card_y, x_2 + card_w, card_y + card_h], radius=16, fill=card_bg)
        draw.text((x_2 + 20, card_y + 40), "총 거래 횟수", font=font_card_title, fill="#8B858F")
        # DB에서 가져온 횟수 표시
        draw.text((x_2 + 20, card_y + 85), f"{user_data['buy_count']}", font=font_card_value, fill="white")

        # 3. 역할 -> '구매 등급' 카드로 변경 (레이아웃 참고: 다크 핑크 테마 적용)
        x_3 = 40 + (card_w + gap) * 2
        draw.rounded_rectangle([x_3, card_y, x_3 + card_w, card_y + card_h], radius=16, fill=card_bg)
        draw.text((x_3 + 20, card_y + 40), "구매 등급", font=font_card_title, fill="#8B858F")
        # 유저의 구매 등급 가져오기
        highest_tier_role = get_highest_tier_name(target, BUY_TIERS_CONFIG)
        draw.text((x_3 + 20, card_y + 85), highest_tier_role, font=font_card_tier, fill="#FFC1D6")


        # 4. 초대 횟수 -> '서버 구매 순위' 카드로 변경 (순위 DB에서 계산)
        x_4 = 40 + (card_w + gap) * 3
        draw.rounded_rectangle([x_4, card_y, x_4 + card_w, card_y + card_h], radius=16, fill=card_bg)
        draw.text((x_4 + 20, card_y + 40), "서버 구매 순위", font=font_card_title, fill="#8B858F")
        # DB 데이터를 전체 계산하여 유저 순위 구하기
        purchase_rank_str = get_user_rank(target.id)
        draw.text((x_4 + 20, card_y + 85), purchase_rank_str, font=font_card_value, fill="#FFC1D6")


        # --- 하단 풋터 구역 ---
        footer_y = 430
        draw.text((40, footer_y), f"ⓘ  2026.09.06 이후의 데이터만 기록됩니다.", font=font_footer, fill="#5A555E")
        draw.text((710, footer_y), "SODDU DISCORD SERVER", font=font_footer, fill="#5A555E")

        # 이미지 전송
        with io.BytesIO() as image_binary:
            image.save(image_binary, 'PNG')
            image_binary.seek(0)
            await message.channel.send(file=discord.File(fp=image_binary, filename='profile.png'))

    # --- [ $서버통계 및 $구매랭크는 기존 코드 유지하되 DB 데이터 기반으로 작동 ] ---
    elif cmd_name == '서버통계':
        # DB에서 전체 유저 데이터 합산 로직 필요
        pass
    
    elif cmd_name == '구매랭크':
        # DB에서 전체 유저 상위 정렬 로직 필요
        pass

# 봇 실행
client.run(TOKEN)
