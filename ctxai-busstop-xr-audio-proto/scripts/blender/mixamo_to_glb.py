# Mixamo FBX → 동작이 합쳐진 GLB 하나. Blender 헤드리스로 돌린다.
#
#   blender -b -P scripts/blender/mixamo_to_glb.py -- <character.fbx> <out.glb> <anim1.fbx> [anim2.fbx ...]
#
# 준비: Mixamo(https://www.mixamo.com, Adobe 계정)에서
#   1) 인물 하나를 골라 "T-pose" 또는 아무 동작 없이 FBX(With Skin) 로 내려받는다 → character.fbx
#   2) 같은 인물로 동작을 골라 FBX(Without Skin) 로 내려받는다 → Sitting Idle / Sitting Talking / Stand Up / Walking / Idle
# 이 스크립트는 인물의 메시·뼈대를 읽고, 동작 FBX 들의 액션을 같은 뼈대에 붙여 GLB 로 내보낸다.
# 클립 이름은 FBX 파일명(확장자 제외)이 된다 — 앱은 그 이름으로 클립을 고른다 (components/ReactiveStage.jsx RiggedPerson).
#
# 텍스처는 1024 로 줄인다. 결과는 gltf-transform meshopt 로 한 번 더 압축하면 3~6MB 가 된다:
#   npx @gltf-transform/cli meshopt out.glb out.min.glb

import bpy, sys, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 2:
    print("usage: blender -b -P mixamo_to_glb.py -- character.fbx out.glb [anim.fbx ...]")
    sys.exit(1)
char_fbx, out_glb, anim_fbxs = argv[0], argv[1], argv[2:]

bpy.ops.wm.read_factory_settings(use_empty=True)

def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True, ignore_leaf_bones=True, automatic_bone_orientation=False)
    return [o for o in bpy.data.objects if o not in before]

# 1) 인물
objs = import_fbx(char_fbx)
armature = next((o for o in objs if o.type == "ARMATURE"), None)
if armature is None:
    print("인물 FBX 에 뼈대가 없습니다"); sys.exit(2)
armature.name = "Armature"
# Mixamo 는 cm 단위 → 0.01 로 들어오는 스케일을 적용해 미터로
for o in objs:
    if o.parent is None:
        o.scale = (o.scale[0], o.scale[1], o.scale[2])
bpy.ops.object.select_all(action="DESELECT")
for o in objs: o.select_set(True)
bpy.context.view_layer.objects.active = armature
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

# 인물 자체 액션(T-pose 등)은 버린다
if armature.animation_data and armature.animation_data.action:
    armature.animation_data.action = None

# 2) 동작들 — 각 FBX 의 뼈대 액션을 인물 뼈대로 옮긴다 (뼈 이름이 mixamorig:* 로 같으므로 그대로 붙는다)
actions = []
for path in anim_fbxs:
    name = os.path.splitext(os.path.basename(path))[0]
    aobjs = import_fbx(path)
    aarm = next((o for o in aobjs if o.type == "ARMATURE"), None)
    if aarm and aarm.animation_data and aarm.animation_data.action:
        act = aarm.animation_data.action
        act.name = name
        act.use_fake_user = True
        actions.append(act)
    # 임시 오브젝트 제거
    for o in aobjs:
        bpy.data.objects.remove(o, do_unlink=True)

# NLA 트랙으로 전부 실어 두면 glTF 내보내기가 클립 여러 개로 내보낸다
if armature.animation_data is None:
    armature.animation_data_create()
for act in actions:
    track = armature.animation_data.nla_tracks.new()
    track.name = act.name
    strip = track.strips.new(act.name, int(act.frame_range[0]), act)
    strip.name = act.name

# 3) 텍스처 축소
for img in bpy.data.images:
    if img.size[0] > 1024 or img.size[1] > 1024:
        img.scale(min(1024, img.size[0]), min(1024, img.size[1]))

# 4) GLB 내보내기
bpy.ops.export_scene.gltf(
    filepath=out_glb, export_format="GLB", export_animations=True, export_nla_strips=True,
    export_apply=True, export_yup=True, export_skins=True, export_image_format="AUTO",
    export_texcoords=True, export_normals=True, export_materials="EXPORT",
)
print("exported", out_glb, "clips:", [a.name for a in actions])
