import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1536, 808
BASE = os.path.dirname(os.path.abspath(__file__))

FONT_REG = os.path.join(BASE, "fonts", "Pretendard-Regular.ttf")
FONT_BOLD = os.path.join(BASE, "fonts", "Pretendard-Bold.ttf")

# ──────────────────────────────────────────
# 역할별 색상 매핑 테이블
# ──────────────────────────────────────────
ROLE_COLORS = {
    "서버 오너": "#FF79C6",
    "서버 관리자": "#F58FBD",
    "판매자": "#50FA7B",
    "회원": "#A3E635",
    "Crystal": "#C084FC",
    "Emerald": "#34D399",
    "Ruby": "#F87171",
    "Gold": "#FACC15",
    "Silver": "#FB923C",
    "Bronze": "#D97706"
}

DEFAULT_PINK = "#F58FBD"
WHITE = "#F2EDF0"
GRAY = "#9B969B"
DARK_GRAY = "#656166"
CARD = "#171719"
LINE = "#353236"


def F(size, bold=False):
    font_path = FONT_BOLD if bold else FONT_REG
    if os.path.exists(font_path):
        return ImageFont.truetype(font_path, size)
    return ImageFont.load_default()


def text(draw, xy, value, size, color=WHITE, bold=False):
    draw.text(
        xy,
        str(value),
        font=F(size, bold),
        fill=color
    )


def rounded(draw, xy, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(
        xy,
        radius=radius,
        fill=fill,
        outline=outline,
        width=width
    )


def make_info(
    username,
    discriminator,
    joined,
    role,
    total_trade,
    trade_count,
    max_trade,
    invites,
    rank,
    avatar=None
):
    # 역할에 따른 테마 색상 자동 결정
    theme_color = ROLE_COLORS.get(role, DEFAULT_PINK)

    img = Image.new("RGB", (W, H), "#0D0D0F")
    draw = ImageDraw.Draw(img)

    # ==========================================
    # 전체 테두리
    # ==========================================
    rounded(
        draw,
        (23, 40, 1513, 767),
        31,
        "#101012",
        "#543747",
        2
    )

    # ==========================================
    # 프로필 이미지
    # ==========================================
    if avatar and os.path.exists(avatar):
        av = Image.open(avatar).convert("RGB")
        av = av.resize((205, 205))

        mask = Image.new("L", (205, 205), 0)
        md = ImageDraw.Draw(mask)
        md.ellipse((0, 0, 205, 205), fill=255)

        img.paste(av, (88, 113), mask)

    # 테마 색상 테두리
    draw.ellipse(
        (78, 103, 303, 328),
        outline=theme_color,
        width=4
    )

    # 온라인 표시
    draw.ellipse(
        (249, 270, 294, 315),
        fill=theme_color,
        outline="#101012",
        width=6
    )

    # ==========================================
    # 사용자 이름 & 역할
    # ==========================================
    text(
        draw,
        (352, 127),
        username,
        64,
        "#F5EAF0",
        True
    )

    text(
        draw,
        (353, 209),
        discriminator,
        31,
        DARK_GRAY
    )

    # 역할 텍스트 (깨짐 방지를 위해 특수문자 왕관 제거 후 테마색 적용)
    text(
        draw,
        (352, 266),
        role,
        30,
        theme_color,
        True
    )

    # ==========================================
    # 가입일
    # ==========================================
    # 깨지는 ▣ 대신 호환되는 ■ 사용
    text(
        draw,
        (772, 195),
        "■",
        28,
        "#AAA5AA"
    )

    text(
        draw,
        (825, 193),
        "가입일",
        24,
        "#AAA5AA"
    )

    text(
        draw,
        (825, 231),
        joined,
        29,
        WHITE
    )

    # 세로선
    draw.line(
        (1039, 166, 1039, 273),
        fill="#3A373A",
        width=2
    )

    # ==========================================
    # 서버 정보
    # ==========================================
    text(
        draw,
        (1100, 190),
        "●",
        28,
        "#B9B5B9"
    )

    text(
        draw,
        (1150, 184),
        "서버",
        24,
        "#AAA5AA"
    )

    text(
        draw,
        (1150, 220),
        "SODDU DISCORD SERVER",
        17,
        WHITE,
        True
    )

    text(
        draw,
        (1449, 216),
        ">",
        32,
        theme_color,
        True
    )

    text(
        draw,
        (1150, 257),
        "S I N C E  2 0 2 0",
        12,
        "#644354"
    )

    # ==========================================
    # 통계 카드 배경
    # ==========================================
    card_y1 = 354
    card_y2 = 650

    cards = [
        (56, card_y1, 400, card_y2),
        (418, card_y1, 760, card_y2),
        (778, card_y1, 1120, card_y2),
        (1138, card_y1, 1480, card_y2)
    ]

    for box in cards:
        rounded(
            draw,
            box,
            24,
            CARD,
            "#303033",
            2
        )

    # ==========================================
    # 1번 카드 - 총 거래량
    # ==========================================
    text(draw, (94, 396), "◆", 28, theme_color)
    text(draw, (140, 403), "총 거래량", 25, "#C1BCC1")

    text(
        draw,
        (95, 465),
        total_trade,
        47,
        WHITE,
        True
    )

    draw.line(
        (95, 535, 360, 535),
        fill=LINE,
        width=2
    )

    text(draw, (95, 558), "최대 거래 금액", 20, "#AAA5AA")

    text(
        draw,
        (95, 593),
        max_trade,
        27,
        WHITE,
        True
    )

    # ==========================================
    # 2번 카드 - 거래 횟수
    # ==========================================
    text(draw, (456, 396), "■", 28, theme_color)
    text(draw, (500, 403), "총 거래 횟수", 25, "#C1BCC1")

    text(
        draw,
        (456, 466),
        trade_count,
        47,
        WHITE,
        True
    )

    # ==========================================
    # 3번 카드 - 역할
    # ==========================================
    text(draw, (816, 396), "★", 28, theme_color)
    text(draw, (860, 403), "역할", 25, "#C1BCC1")

    text(
        draw,
        (817, 479),
        role,
        31,
        theme_color,
        True
    )

    # ==========================================
    # 4번 카드 - 초대
    # ==========================================
    text(draw, (1177, 396), "●", 28, theme_color)
    text(draw, (1220, 403), "초대 횟수", 25, "#C1BCC1")

    text(
        draw,
        (1177, 466),
        invites,
        47,
        WHITE,
        True
    )

    draw.line(
        (1177, 535, 1440, 535),
        fill=LINE,
        width=2
    )

    text(
        draw,
        (1177, 558),
        "서버 순위",
        20,
        "#AAA5AA"
    )

    text(
        draw,
        (1378, 549),
        rank,
        42,
        theme_color,
        True
    )

    # ==========================================
    # 하단
    # ==========================================
    text(
        draw,
        (66, 703),
        "i",
        22,
        theme_color,
        True
    )

    text(
        draw,
        (95, 707),
        "2026.09.06 이후의 데이터만 기록됩니다.",
        19,
        "#AAA5AA"
    )

    draw.line(
        (704, 718, 1141, 718),
        fill=LINE,
        width=2
    )

    text(
        draw,
        (1172, 708),
        "S O D D U  D I S C O R D  S E R V E R",
        12,
        "#634353",
        True
    )

    return img


# ==========================================
# 테스트
# ==========================================
if __name__ == "__main__":
    image = make_info(
        username="lawf_luna",
        discriminator="#0001",
        joined="2026. 3. 18",
        role="서버 관리자",
        total_trade="₩0",
        trade_count="0",
        max_trade="₩0",
        invites="0",
        rank="#1",
        avatar="avatar.png"
    )

    image.save("user_info.png")
