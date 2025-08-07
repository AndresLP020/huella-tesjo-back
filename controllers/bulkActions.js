import Assignment from '../models/Assignment.js';
import TeacherStats from '../models/TeacherStats.js';

// Marcar múltiples asignaciones como completadas
export const markMultipleAssignmentsCompleted = async (req, res) => {
    try {
        const { assignmentIds } = req.body;
        const now = new Date();

        if (!Array.isArray(assignmentIds) || assignmentIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Debe proporcionar al menos una asignación para marcar'
            });
        }

        // Actualizar todas las asignaciones seleccionadas
        const result = await Assignment.updateMany(
            { 
                _id: { $in: assignmentIds },
                status: { $ne: 'completed' } // Solo actualizar las que no estén completadas
            },
            {
                $set: {
                    status: 'completed',
                    completedAt: now,
                    completedBy: req.user._id,
                    adminCompleted: true
                }
            }
        );

        // Obtener las asignaciones actualizadas para actualizar estadísticas
        const updatedAssignments = await Assignment.find({ _id: { $in: assignmentIds } })
            .populate('assignedTo', 'nombre apellidoPaterno apellidoMaterno email');

        // Actualizar estadísticas para cada profesor afectado
        const teacherIds = new Set();
        updatedAssignments.forEach(assignment => {
            assignment.assignedTo.forEach(teacher => {
                teacherIds.add(teacher._id.toString());
            });
        });

        // Actualizar estadísticas en paralelo
        await Promise.all(
            Array.from(teacherIds).map(teacherId => 
                TeacherStats.updateTeacherStats(teacherId)
            )
        );

        res.json({
            success: true,
            message: `${result.modifiedCount} asignaciones marcadas como completadas`,
            modifiedCount: result.modifiedCount
        });

    } catch (error) {
        console.error('Error al marcar múltiples asignaciones:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error al marcar las asignaciones como completadas'
        });
    }
};
