// js/config.js — настройки игры MB World 3D
export const CONFIG = {
  version: '0.1.0',
  threeCDN: 'https://cdn.jsdelivr.net/npm/three@0.160.0',

  // Все пути относительные: работают на GitHub Pages
  paths: {
    miku: {
      idle: 'assets/characters/miku/idle.glb',
      walk: 'assets/characters/miku/walk.glb',
      run: 'assets/characters/miku/run.glb',
      jump: 'assets/characters/miku/jump.glb',
      death: 'assets/characters/miku/death.glb'
    }
  },

  // Кости скелета Miku (24 кости, пальцев нет)
  bones: {
    hips: 'Hips',
    spine: 'Spine',
    spine1: 'Spine01',
    spine2: 'Spine02',
    neck: 'neck',
    head: 'Head',
    lShoulder: 'LeftShoulder',
    lArm: 'LeftArm',
    lForeArm: 'LeftForeArm',
    lHand: 'LeftHand',
    rShoulder: 'RightShoulder',
    rArm: 'RightArm',
    rForeArm: 'RightForeArm',
    rHand: 'RightHand',
    lUpLeg: 'LeftUpLeg',
    lLeg: 'LeftLeg',
    lFoot: 'LeftFoot',
    rUpLeg: 'RightUpLeg',
    rLeg: 'RightLeg',
    rFoot: 'RightFoot'
  },

  // Имена клипов внутри GLB
  clips: {
    idle: 'Armature|Idle_4|baselayer',
    walk: 'Armature|walking_man|baselayer',
    run: 'Armature|running|baselayer',
    jump: 'Armature|Regular_Jump|baselayer',
    death: 'Armature|Shot_and_Slow_Fall_Backward|baselayer'
  },

  player: {
    height: 1.7,
    walkSpeed: 2.2,
    runSpeed: 4.6,
    sprintSpeed: 7.0,
    turnSpeed: 10,
    jumpVelocity: 6.5,
    gravity: -20,
    dodgeSpeed: 9,
    dodgeTime: 0.35,
    maxHp: 18645,
    fade: 0.25
  },

  camera: {
    distance: 5.2,
    height: 1.5,
    minPitch: -0.35,
    maxPitch: 1.1,
    smooth: 8,
    sensitivity: 0.0035
  },

  // Оружие. grip — подгонка положения в кисти, настраивается после теста
  weapons: {
    sword_sigil_06: {
      name: 'Меч Сигил', type: 'sword1h', rarity: 'rare',
      file: 'assets/weapons/sword_sigil_06.glb',
      damage: 120, speed: 1.0, length: 1.1,
      grip: { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 }
    },
    longsword_sleipner: {
      name: 'Длинный меч', type: 'sword2h', rarity: 'epic',
      file: 'assets/weapons/longsword_sleipner.glb',
      damage: 210, speed: 0.65, length: 1.3,
      grip: { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 }
    },
    blade_dark_01: {
      name: 'Тёмный клинок', type: 'dagger', rarity: 'rare',
      file: 'assets/weapons/blade_dark_01.glb',
      damage: 70, speed: 1.6, length: 0.6,
      grip: { pos: [0, 0, 0], rot: [0, 0, 0], scale: 0.6 }
    },
    axe_relic_01: {
      name: 'Реликтовый топор', type: 'axe', rarity: 'epic',
      file: 'assets/weapons/axe_relic_01.glb',
      damage: 190, speed: 0.75, length: 1.0,
      grip: { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 }
    },
    hammer_runic_01: {
      name: 'Рунный молот', type: 'hammer', rarity: 'legendary',
      file: 'assets/weapons/hammer_runic_01.glb',
      damage: 260, speed: 0.55, length: 1.1,
      grip: { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 }
    }
  },

  shields: {
    kite_shield: {
      name: 'Щит-«змей»', type: 'shield', rarity: 'rare',
      file: 'assets/shields/kite_shield.glb',
      block: 0.7,
      grip: { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 }
    }
  },

  // Параметры боя по типу оружия: окна комбо и множители
  combat: {
    sword1h:  { combo: 3, hitTime: 0.35, window: 0.5, heavyMul: 1.8 },
    sword2h:  { combo: 2, hitTime: 0.6,  window: 0.7, heavyMul: 2.0 },
    dagger:   { combo: 4, hitTime: 0.2,  window: 0.35, heavyMul: 1.5 },
    axe:      { combo: 2, hitTime: 0.55, window: 0.65, heavyMul: 2.0 },
    hammer:   { combo: 2, hitTime: 0.7,  window: 0.8, heavyMul: 2.2 },
    unarmed:  { combo: 2, hitTime: 0.3,  window: 0.4, heavyMul: 1.4 }
  },

  rarity: {
    common: '#c8c8c8', uncommon: '#6fd16f', rare: '#5aa7ff',
    epic: '#b46cff', legendary: '#ffb534'
  },

  // Для телефонов: меньше теней и пикселей
  quality: { maxPixelRatio: 2, shadowMap: 1024, mobileShadowMap: 512 }
};
