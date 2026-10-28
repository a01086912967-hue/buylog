// 서버 역할 / 구매 등급 설정
// - 위에 있을수록 높은 등급이에요. 여러 개를 가지고 있으면 가장 높은 것 하나만 적용돼요.
// - c1 / c2 : 그라데이션 색, main : 글자·아이콘 색, text : 뱃지 글자 색
 
const TIER_ROLES = [
    { id: '1489943721146449920', name: '크리스탈', c1: '#59d8ff', c2: '#a77bff', main: '#7b6cf0', text: '#ffffff' },
    { id: '1456737896525725719', name: '에메랄드', c1: '#3ddc97', c2: '#0f9f62', main: '#0f9f62', text: '#ffffff' },
    { id: '1456736865779581031', name: '루비', c1: '#ff6b8a', c2: '#c9254b', main: '#d92b52', text: '#ffffff' },
    { id: '1456736771344826535', name: '골드', c1: '#ffd54a', c2: '#e8a000', main: '#d99500', text: '#5a3b00' },
    { id: '1456736573797171384', name: '실버', c1: '#e3e9f2', c2: '#9aa8bc', main: '#7b8aa0', text: '#33465e' },
    { id: '1457383788236505299', name: '브론즈', c1: '#eeb07a', c2: '#b8672a', main: '#b8702f', text: '#ffffff' },
];
 
const SERVER_ROLES = [
    { id: '1456729030459134117', name: '오너', c1: '#ff9ec0', c2: '#e0457f', main: '#e0457f', text: '#ffffff' },
    { id: '1458178323434836199', name: '관리자', c1: '#8aa2ff', c2: '#4f6cf0', main: '#4f6cf0', text: '#ffffff' },
    { id: '1545686320993796126', name: '관리자', c1: '#8aa2ff', c2: '#4f6cf0', main: '#4f6cf0', text: '#ffffff' },
    { id: '1456747541348749342', name: '판매자', c1: '#4fd8c8', c2: '#12a898', main: '#12a898', text: '#ffffff' },
    { id: '1456735270119411734', name: '서버 회원', c1: '#9cc3ee', c2: '#5f95d0', main: '#5f95d0', text: '#ffffff' },
];
 
// 역할 정보가 없을 때(서버를 나간 유저 등) 쓰는 기본 색
const DEFAULT_GRADE = { id: null, name: '', c1: '#9cc3ee', c2: '#5f95d0', main: '#5f95d0', text: '#ffffff' };
 
// member: discord.js GuildMember (없으면 null)
// 반환: { tier: 구매 등급 | null, serverRole: 서버 역할 | null, color: 프로필에 쓸 색 }
function resolveGrade(member) {
    const has = (id) => !!(member && member.roles && member.roles.cache && member.roles.cache.has(id));
    const tier = TIER_ROLES.find((r) => has(r.id)) || null;
    const serverRole = SERVER_ROLES.find((r) => has(r.id)) || null;
    // 구매 등급이 있으면 그 색, 없으면 서버 역할 색
    const color = tier || serverRole || DEFAULT_GRADE;
    return { tier, serverRole, color };
}
 
module.exports = { TIER_ROLES, SERVER_ROLES, DEFAULT_GRADE, resolveGrade };
 
