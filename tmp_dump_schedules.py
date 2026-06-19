import os
import sys
sys.path.append('c:/Users/janna/Downloads/labsecure-ai-v2 2/labsecure-ai-v2')

from backend.db.repositories import ScheduleRepository
from backend.db.schemas import ScheduleModel

try:
    schedules = ScheduleRepository.get_all()
    print(f"Loaded {len(schedules)} schedules.")
    for s in schedules:
        print(f"ID: {s.id} | Name: {s.name} | Room: {s.room_id} | TeacherID: '{s.teacher_id}' | Roles: {s.roles}")
except Exception as e:
    print(f"Error: {e}")
